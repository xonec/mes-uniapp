'use strict'

const crypto = require('crypto')
const { ClientError } = require('mes-common')
const { updatedCount } = require('mes-document-store')

const CACHE_COLL = 'ocr_cache'
const LEASE_MS = 210000
const FAILURE_COOLDOWN_MS = 30000
const MAX_ACQUIRE_ATTEMPTS = 4

function cachedResult(record, cacheMinutes, now) {
    if (!record || !(Number(cacheMinutes) > 0)) return null
    if (record.status !== 'ready' && record.status !== undefined) return null
    if (!(Number(record.expireAt) > now)) return null
    const result = record.result
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null
}

function isDuplicate(error) {
    const message = String(error && (error.message || error.errMsg) || error)
    const code = String(error && (error.code || error.errCode) || '')
    return /duplicate|already.*exist|document.*exist|重复|已存在|E11000/i.test(message + ' ' + code)
}

function previousField(db, record, field) {
    return record[field] === undefined ? db.command.exists(false) : record[field]
}

/** 只读取已完成缓存，供主动大模型识别复用初筛，不重新调用免费 OCR 或占用初筛租约。 */
async function readRecognition(db, key, cacheMinutes, checkPending = false) {
    const response = await db.collection(CACHE_COLL).doc(key).get()
    if (!response || !Array.isArray(response.data)) throw new ClientError('识别缓存暂时无法读取，已停止识别，请稍后重试', 503)
    const record = response.data[0], now = Date.now()
    const cached = cachedResult(record, cacheMinutes, now)
    if (cached) return cached
    if (checkPending && record && Number(record.leaseUntil) > now) {
        if (record.status === 'processing') throw new ClientError('相同照片正在处理，请稍后重试，无需重复上传', 429)
        if (record.status === 'failed') throw new ClientError('相同照片近期识别失败，请稍等后重试', 429)
    }
    return null
}

/** 确认续传/清理请求持有本次上传租约，防止其他请求抢占或释放上传状态。 */
async function assertRecognitionOwner(db, key, owner) {
    if (!/^upload:c:[a-f0-9]{64}$/.test(String(key || '')) || !/^[a-f0-9]{32}$/.test(String(owner || ''))) throw new ClientError('原图上传校验信息非法，请重新识别', 400)
    const response = await db.collection(CACHE_COLL).doc(key).get()
    if (!response || !Array.isArray(response.data)) throw new ClientError('原图上传状态暂时无法读取', 503)
    const record = response.data[0]
    if (!record || record.owner !== owner || record.status !== 'processing' || !(Number(record.leaseUntil) > Date.now())) throw new ClientError('原图上传状态已过期，请重新识别', 409)
}

/**
 * 读取有效识别缓存，或通过数据库唯一主键与条件更新取得识别租约。
 * @param {object} db uniCloud 数据库实例。
 * @param {string} key 包含完整输入与识别配置的缓存主键。
 * @param {number} cacheMinutes 大于零时允许返回已完成缓存。
 * @param {string} label 并发状态提示，可按照片或产品编码区分。
 * @returns {Promise<{cached: object}|{owner: string}>} 缓存结果或本次识别的租约所有者。
 */
async function acquireRecognition(db, key, cacheMinutes, label = '同一照片', leaseMs = LEASE_MS) {
    const owner = crypto.randomBytes(16).toString('hex')
    const collection = db.collection(CACHE_COLL)
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
        const response = await collection.doc(key).get()
        const old = (response.data || [])[0] || null
        const now = Date.now()
        const cached = cachedResult(old, cacheMinutes, now)
        if (cached) return { cached }
        if (old && Number(old.leaseUntil) > now) {
            if (old.status === 'processing') throw new ClientError(label + '正在识别，请稍后读取已有结果', 429)
            if (old.status === 'failed') throw new ClientError(label + '近期识别失败，请稍等后重试', 429)
        }
        const pending = {
            status: 'processing', owner, leaseUntil: now + leaseMs,
            result: {}, expireAt: 0, updatedAt: now
        }
        if (!old) {
            try {
                await collection.add({ _id: key, ...pending, createdAt: now })
                return { owner }
            } catch (error) {
                if (!isDuplicate(error)) throw error
                continue
            }
        }
        const where = {
            _id: key,
            owner: previousField(db, old, 'owner'),
            leaseUntil: previousField(db, old, 'leaseUntil')
        }
        if (updatedCount(await collection.where(where).update(pending)) > 0) return { owner }
    }
    throw new ClientError(label + '的识别请求发生冲突，请稍后重试', 429)
}

/**
 * 由当前租约所有者发布已完成结果；租约被其他请求接管时拒绝覆盖。
 * @param {object} db uniCloud 数据库实例。
 * @param {string} key 缓存主键。
 * @param {string} owner acquireRecognition 返回的所有者标识。
 * @param {object} result 已校验的识别结果。
 * @param {number} cacheMinutes 结果可复用的分钟数，零表示不复用。
 * @returns {Promise<void>}
 */
async function completeRecognition(db, key, owner, result, cacheMinutes) {
    const now = Date.now()
    const minutes = Number(cacheMinutes)
    const resultUpdate = await db.collection(CACHE_COLL).where({ _id: key, owner }).update({
        status: 'ready', result,
        expireAt: Number.isFinite(minutes) && minutes > 0 ? now + minutes * 60000 : 0,
        leaseUntil: 0, updatedAt: now
    })
    if (updatedCount(resultUpdate) === 0) throw new ClientError('识别结果暂时无法保存，请稍后重试', 503)
}

/**
 * 释放本次失败识别并设置短暂冷却，避免连续点击重复产生模型费用。
 * @param {object} db uniCloud 数据库实例。
 * @param {string} key 缓存主键。
 * @param {string} owner acquireRecognition 返回的所有者标识。
 * @returns {Promise<void>}
 */
async function failRecognition(db, key, owner) {
    const now = Date.now()
    const result = await db.collection(CACHE_COLL).where({ _id: key, owner }).update({
        status: 'failed', result: {}, expireAt: 0,
        leaseUntil: now + FAILURE_COOLDOWN_MS, updatedAt: now
    })
    // 已被其他所有者接管时无需再写；数据库返回值异常则继续抛出。
    updatedCount(result)
}

module.exports = { readRecognition, assertRecognitionOwner, acquireRecognition, completeRecognition, failRecognition }
