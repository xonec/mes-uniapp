'use strict'

// 云函数：production-records
// 用途：production_records 集合（生产记录）的受控读写入口，实现多端共享 + 版本历史。
//
// 版本机制：
//   - 主表 production_records 存「最新版」（固定 _id = rec:<批号>，覆盖写），读最新很快。
//   - 每次保存/回滚前，把旧版本快照归档到 production_record_versions（_id = ver:<批号>:<版本号>，追加不覆盖）。
//   - 写入用乐观锁（按 version 条件更新）防并发丢版本，冲突自动重试。
//   - 每批最多保留 MAX_VERSIONS 个历史版本，超出删最老。
//
// 依赖公共模块 mes-common（鉴权 / 响应封装）；密钥从环境变量 MES_TOKEN_SECRET 读取。

const { checkAuth, ok, fail } = require('mes-common')

const COLL = 'production_records'
const VER_COLL = 'production_record_versions'
const DRAFT_COLL = 'production_drafts'
const MAX_VERSIONS = 50 // 每批最多保留的历史版本数（超出删最老）

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃（无法被 try/catch 捕获）
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

function docId(batchNo) {
    return 'rec:' + String(batchNo)
}

function verId(batchNo, version) {
    return 'ver:' + String(batchNo) + ':' + version
}

function normalizeBatchNo(v) {
    const s = String(v || '').trim().toUpperCase()
    if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(s)) {
        throw new Error('批号非法：须为 11 位且同时含字母与数字')
    }
    return s
}

// 归一化 update() 返回的实际更新条数（不同 SDK 版本字段名不同）
function updatedCount(r) {
    if (!r) return 0
    if (typeof r.updated === 'number') return r.updated
    if (r.result && typeof r.result.updated === 'number') return r.result.updated
    if (r.result && typeof r.result.affectedDocs === 'number') return r.result.affectedDocs
    return 0
}

// 归档旧版本到历史表（幂等）+ 保留策略（超出 MAX_VERSIONS 删最老）
async function archiveVersion(batchNo, doc) {
    const version = doc.version || 1
    const snap = Object.assign({}, doc)
    delete snap._id
    try {
        await db.collection(VER_COLL).doc(verId(batchNo, version)).set({
            batchNo, version, savedAt: doc.savedAt || null, snapshot: snap
        })
    } catch (e) {
        console.error('历史版本写入失败：', e && e.message)
    }
    const cleanupVer = version - MAX_VERSIONS
    if (cleanupVer >= 1) {
        try { await db.collection(VER_COLL).doc(verId(batchNo, cleanupVer)).remove() } catch (e) {}
    }
}

// 乐观锁写入：读旧 → 归档 → 条件覆盖（version 未变才成功），并发冲突自动重试
async function upsertLocked(batchNo, cleanRecord, authUid) {
    const id = docId(batchNo)
    for (let attempt = 0; attempt < 5; attempt++) {
        const oldRes = await db.collection(COLL).doc(id).get()
        const old = (oldRes && oldRes.data && oldRes.data[0]) || null
        const newVersion = old ? (old.version || 0) + 1 : 1
        if (old) await archiveVersion(batchNo, old)

        const data = Object.assign({}, cleanRecord, {
            batchNo, version: newVersion, updatedAt: Date.now(), savedBy: authUid
        })

        if (old) {
            // 乐观锁：仅当 version 未变时覆盖，防止并发丢版本
            const r = await db.collection(COLL).where({ _id: id, version: old.version }).update(data)
            if (updatedCount(r)) return { _id: id, batchNo, version: newVersion }
            continue
        }
        // 无旧记录：add（撞唯一键说明并发创建，重试）
        try {
            await db.collection(COLL).add(Object.assign({}, data, { _id: id }))
            return { _id: id, batchNo, version: newVersion }
        } catch (e) {
            continue
        }
    }
    throw new Error('并发保存冲突，请重试')
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        db = getDb()

        if (action === 'upsert') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const record = (event.record && typeof event.record === 'object') ? event.record : {}
            const batchNo = normalizeBatchNo(record.batchNo)
            const clean = Object.assign({}, record)
            delete clean._id
            return ok(await upsertLocked(batchNo, clean, auth.uid))
        }

        if (action === 'get') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = normalizeBatchNo(event.batchNo)
            const res = await db.collection(COLL).doc(docId(batchNo)).get()
            const rows = (res && res.data) || []
            return ok(rows.length ? rows[0] : null)
        }

        if (action === 'list') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const limit = Math.min(Number(event.limit) || 50, 100)
            const skip = Math.max(0, Number(event.skip) || 0)
            const res = await db.collection(COLL)
                .field({ batchNo: true })
                .orderBy('updatedAt', 'desc')
                .skip(skip)
                .limit(limit)
                .get()
            return ok((res && res.data) || [])
        }

        if (action === 'listVersions') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = normalizeBatchNo(event.batchNo)
            const limit = Math.min(Number(event.limit) || 50, 100)
            const res = await db.collection(VER_COLL)
                .where({ batchNo })
                .orderBy('version', 'desc')
                .limit(limit)
                .get()
            return ok((res && res.data) || [])
        }

        if (action === 'rollback') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = normalizeBatchNo(event.batchNo)
            const version = Number(event.version)
            if (!version || version < 1) return fail(400, '版本号非法')

            // 读历史版本快照（回滚目标是固定的，不随并发变化）
            const verRes = await db.collection(VER_COLL).doc(verId(batchNo, version)).get()
            const verRow = (verRes && verRes.data && verRes.data[0]) || null
            if (!verRow || !verRow.snapshot) return fail(404, '该历史版本不存在')
            const snapshot = Object.assign({}, verRow.snapshot)
            delete snapshot._id

            // 乐观锁：读当前 → 归档当前 → 条件覆盖为快照新版本
            const id = docId(batchNo)
            for (let attempt = 0; attempt < 5; attempt++) {
                const curRes = await db.collection(COLL).doc(id).get()
                const cur = (curRes && curRes.data && curRes.data[0]) || null
                const newVersion = cur ? (cur.version || 0) + 1 : 1
                if (cur) await archiveVersion(batchNo, cur)

                const data = Object.assign({}, snapshot, {
                    batchNo, version: newVersion, updatedAt: Date.now(), savedBy: auth.uid
                })

                if (cur) {
                    const r = await db.collection(COLL).where({ _id: id, version: cur.version }).update(data)
                    if (updatedCount(r)) return ok({ _id: id, batchNo, version: newVersion })
                    continue
                }
                try {
                    await db.collection(COLL).add(Object.assign({}, data, { _id: id }))
                    return ok({ _id: id, batchNo, version: newVersion })
                } catch (e) {
                    continue
                }
            }
            return fail(409, '回滚冲突，请重试')
        }

        if (action === 'saveDraft') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const deviceId = String(event.deviceId || '').trim()
            if (!deviceId) return fail(400, '缺少 deviceId')
            const record = (event.record && typeof event.record === 'object') ? event.record : {}
            const batchNo = normalizeBatchNo(record.batchNo)
            await db.collection(DRAFT_COLL).doc('draft:' + deviceId + ':' + batchNo).set({
                deviceId,
                batchNo,
                record,
                updatedAt: Date.now()
            })
            return ok({ batchNo })
        }

        if (action === 'getDraft') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const deviceId = String(event.deviceId || '').trim()
            if (!deviceId) return fail(400, '缺少 deviceId')
            const batchNo = normalizeBatchNo(event.batchNo)
            const res = await db.collection(DRAFT_COLL).doc('draft:' + deviceId + ':' + batchNo).get()
            const rows = (res && res.data) || []
            return ok(rows.length ? rows[0] : null)
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[production-records] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '内部错误: ' + (e && (e.message || e.errMsg) || JSON.stringify(e)))
    }
}
