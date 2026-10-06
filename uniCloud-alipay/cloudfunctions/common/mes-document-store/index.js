'use strict'
const { ClientError } = require('mes-common')
const { addImmutable } = require('./source-store')
const { sourcePages } = require('./trace-fields')

/** 获取云数据库条件更新的实际写入数。 */
function updatedCount(result) {
    for (const r of [result, result && result.result, result && result.res, result && result.stats, result && result.data]) {
        if (r && typeof r.updated === 'number') return r.updated
        if (r && typeof r.affectedDocs === 'number') return r.affectedDocs
    }
    throw new Error('数据库未返回更新计数')
}

/** 以稳定键序比较业务内容，忽略服务端版本和审计字段。 */
function stableKey(value) {
    if (Array.isArray(value)) return '[' + value.map(stableKey).join(',') + ']'
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableKey(value[key])).join(',') + '}'
    return JSON.stringify(value == null ? null : value)
}

/** 固定主键写入；版本条件保证并发修改不会覆盖已确认之后的新数据。 */
async function saveVersioned(db, options) {
    const { collection, versions, id, key, record, uid, expectedVersion, signature = stableKey } = options
    if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) throw new ClientError('版本号非法', 400)
    for (let attempt = 0; attempt < 4; attempt++) {
        const rows = (await db.collection(collection).doc(id).get()).data || []
        const old = rows[0] || null
        const previousVersion = old ? Number(old.version) || 1 : 0
        if (expectedVersion !== undefined && expectedVersion !== previousVersion) throw new ClientError('数据已被修改，请重新加载并核对后保存', 409)
        if (options.authorizeChange) options.authorizeChange(old, record)
        if (old && signature(old) === signature(record)) return { _id: id, version: previousVersion, unchanged: true }
        const version = previousVersion + 1
        const data = { ...record, version, updatedAt: Date.now(), updatedBy: uid,
            ...(options.audit ? { audit: options.audit(old, version) } : {}) }
        if (!old) {
            try {
                await db.collection(collection).add({ ...data, _id: id })
                return { _id: id, version, unchanged: false }
            } catch (error) {
                if (!/duplicate|exist|already/i.test(String(error.message || error.errMsg || error))) throw error
                if (expectedVersion !== undefined) throw new ClientError('此编码已存在，请重新加载并核对后保存', 409)
                continue
            }
        }
        // 快照失败即终止；只有历史安全落库后才允许修改主记录。
        const archived = await addImmutable(db, versions, { _id: 'ver:' + key + ':' + previousVersion,
            [options.keyField]: key,
            version: previousVersion,
            savedAt: new Date(old.updatedAt || old.savedAt || Date.now()).toISOString(),
            updatedBy: old.updatedBy || old.savedBy || '',
            snapshot: old
        })
        if (stableKey(archived.snapshot) !== stableKey(old)) throw new ClientError('历史版本与当前记录不一致，请重新加载后核对', 409)
        const where = { _id: id, version: old.version === undefined ? db.command.exists(false) : old.version }
        if (updatedCount(await db.collection(collection).where(where).update(data))) return { _id: id, version, unchanged: false }
        if (expectedVersion !== undefined) throw new ClientError('数据已被修改，请重新加载并核对后保存', 409)
    }
    throw new ClientError('并发保存冲突，请稍后重试', 409)
}

/** 每次读取最新记录后检查状态变更，阻止普通录入绕过后台停用权限。 */
function authorizeEnabledChange(old, record, isAdmin, label) {
    const previousEnabled = old ? old.enabled !== false : true
    if (!isAdmin && previousEnabled !== (record.enabled !== false)) throw new ClientError('仅管理员可以停用或启用' + label, 403)
}

/** 分页查询管理列表；关键字使用字面量，避免输入影响正则规则。 */
async function listDocuments(db, collection, event, searchFields, fields) {
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)))
    const keyword = String(event.keyword || '').trim().slice(0, 80)
    const conditions = []
    if (event.status === 'disabled') conditions.push({ enabled: false })
    else if (event.status !== 'all') conditions.push({ enabled: db.command.neq(false) })
    const status = conditions[0] || {}
    let where = status
    if (keyword) {
        const regexp = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        where = db.command.or(searchFields.map(field => ({ ...status, [field]: db.RegExp({ regexp, options: 'i' }) })))
    }
    const coll = db.collection(collection)
    const count = await coll.where(where).count()
    const result = await coll.where(where).orderBy('updatedAt', 'desc').orderBy('_id', 'asc').skip((page - 1) * pageSize).limit(pageSize).field(fields).get()
    return { list: result.data || [], total: count.total || 0, page, pageSize }
}

/** 统一保留物料编号后缀，校验所有客户端提交的物料行。 */
function normalizeMaterials(value, allowEmpty = false) {
    if (!Array.isArray(value) || (!value.length && !allowEmpty)) throw new ClientError('包装材料清单至少需要一行', 400)
    if (value.length > 200) throw new ClientError('物料行数超过上限 200', 400)
    return value.map((row, index) => {
        const item = row && typeof row === 'object' ? row : {}
        const materialCode = String(item.materialCode || '').replace(/\s+/g, '')
        const unit = String(item.unit || '').trim().slice(0, 12)
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(materialCode)) throw new ClientError('第 ' + (index + 1) + ' 行物料编号缺失或非法', 400)
        if (!unit) throw new ClientError('第 ' + (index + 1) + ' 行计量单位缺失', 400)
        return {
            seq: index + 1, materialCode,
            materialName: String(item.materialName || '').trim().slice(0, 120),
            spec: String(item.spec || '').trim().slice(0, 2000),
            materialVersion: item.materialVersion == null || !String(item.materialVersion).trim() ? null : String(item.materialVersion).trim().slice(0, 20), unit,
            sourcePages: sourcePages(item.sourcePages)
        }
    })
}

/** 订单只接受业务字段，审计信息由服务端生成。 */
function normalizeOrder(input) {
    if (!input || typeof input !== 'object') throw new ClientError('订单数据缺失', 400)
    const orderNo = String(input.orderNo || '').trim()
    const productCode = String(input.productCode || '').trim()
    const batchNo = String(input.batchNo || '').trim().toUpperCase()
    if (!/^\d{4,12}$/.test(orderNo)) throw new ClientError('订单号须为 4～12 位数字', 400)
    if (!/^\d{10}$/.test(productCode)) throw new ClientError('产品编码须为 10 位数字', 400)
    if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(batchNo)) throw new ClientError('批号须为 11 位且含字母和数字', 400)
    const plannedQty = Number(input.plannedQty)
    if (input.plannedQty === '' || input.plannedQty == null || !Number.isFinite(plannedQty) || plannedQty < 0) throw new ClientError('计划产量须为非负数', 400)
    return {
        orderNo, productCode, batchNo,
        productName: String(input.productName || '').trim().slice(0, 120),
        packSpec: String(input.packSpec || '').trim().slice(0, 120),
        plannedQty, sampleCount: String(input.sampleCount == null ? '' : input.sampleCount).trim().slice(0, 30),
        materials: normalizeMaterials(input.materials || [], true),
        uncertain: Array.isArray(input.uncertain) ? input.uncertain.filter(value => typeof value === 'string').slice(0, 30) : [],
        enabled: input.enabled !== false
    }
}

/** App 导入与后台订单编辑使用同一归一化和版本写入规则。 */
async function saveOrder(db, input, uid, expectedVersion, isAdmin = false) {
    return require('./order-trace').saveTracedOrder(db, input, uid, expectedVersion, isAdmin, { normalizeOrder, normalizeMaterials, saveVersioned, stableKey, authorizeEnabledChange })
}

module.exports = { saveVersioned, listDocuments, normalizeMaterials, normalizeOrder, saveOrder, stableKey, updatedCount, authorizeEnabledChange }
