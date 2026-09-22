'use strict'

// 云函数：production-records
// 用途：production_records 集合（生产记录）的受控读写入口，实现多端共享 + 版本历史。
//
// 版本机制：
//   - 主表 production_records 存「最新版」（固定 _id = rec:<批号>，覆盖写），读最新很快。
//   - 每次保存/回滚前，把旧版本快照归档到 production_record_versions（_id = ver:<批号>:<版本号>，追加不覆盖）。
//   - 写入用乐观锁（按 version 条件更新）防并发丢版本，冲突自动重试。
//   - 每批最多保留 MAX_VERSIONS 个历史版本，超出删最老。
//   - 保存时「仅内容变化才升版本并归档」：与最新版内容相同（忽略 version/时间戳/账号等元数据）则幂等，
//     不升版本、不归档，仅刷新 updatedAt/savedBy；返回 unchanged=true。回滚属主动变更，照常升版本。
//   - 内容比对用「递归按键排序」的稳定序列化，避免云端键序变化导致去重失效。
//   - 草稿 _id = draft:<uid>:<设备ID>:<批号>，uid 纳入主键以隔离用户，防跨用户读写他人草稿。
//
// 依赖公共模块 mes-common（鉴权 / 响应封装 / ClientError）；密钥从环境变量 MES_TOKEN_SECRET 读取。

const { checkAuth, ok, fail, ClientError } = require('mes-common')

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

// 草稿主键：draft:<uid>:<设备ID>:<批号>
// 把 uid 纳入主键，避免任一登录用户凭一个 deviceId 读写他人草稿。
function normalizeDeviceId(v) {
    const s = String(v || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
    if (!s) throw new ClientError('设备ID非法')
    return s
}
function draftId(uid, deviceId, batchNo) {
    return 'draft:' + String(uid) + ':' + deviceId + ':' + batchNo
}

function normalizeBatchNo(v) {
    const s = String(v || '').trim().toUpperCase()
    if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(s)) {
        throw new ClientError('批号非法：须为 11 位且同时含字母与数字')
    }
    return s
}

// 归一化 update() 返回的实际更新条数（不同云厂商 / SDK 版本字段名不同，逐个兼容）
function updatedCount(r) {
    if (!r) return 0
    const cands = [
        r.updated, r.affectedDocs,
        r.result && r.result.updated, r.result && r.result.affectedDocs,
        r.res && r.res.updated, r.res && r.res.affectedDocs,
        r.stats && r.stats.updated,
        r.data && r.data.updated, r.data && r.data.affectedDocs
    ]
    for (const v of cands) {
        if (typeof v === 'number' && v > 0) return v
    }
    return 0
}

// 判断记录「内容」是否变化：忽略版本/时间戳/账号等元数据，仅对比业务字段。
// 用「递归按键排序」的稳定序列化，避免云端回读后对象键序变化导致比对失效（去重静默不生效）。
const META_KEYS = ['_id', 'version', 'updatedAt', 'savedAt', 'savedBy', 'createdAt', 'batchNo']
function stableKey(v) {
    if (Array.isArray(v)) return '[' + v.map(stableKey).join(',') + ']'
    if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableKey(v[k])).join(',') + '}'
    }
    return JSON.stringify(v === undefined ? null : v)
}
function contentKey(rec) {
    const o = {}
    Object.keys(rec || {}).forEach(k => {
        if (META_KEYS.indexOf(k) < 0) o[k] = rec[k]
    })
    return stableKey(o)
}
function contentEqual(a, b) {
    return contentKey(a) === contentKey(b)
}

// 条件更新是否真的写入成功？
// 先用 SDK 计数（updatedCount）；若返回形状无法识别，则回读主表复核：
//   版本号等于本次要写的版本 且 内容与本次提交一致 → 视为成功。
// 这样既不会把「成功」误报为「并发冲突」，也不会把「被并发覆盖」误判为成功。
async function updateApplied(id, newVersion, expectedRecord, r) {
    if (updatedCount(r)) return true
    try {
        const res = await db.collection(COLL).doc(id).get()
        const cur = (res && res.data && res.data[0]) || null
        if (!cur) return false
        return Number(cur.version) === Number(newVersion) && contentEqual(cur, expectedRecord)
    } catch (e) {
        return false
    }
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

// 乐观锁写入：读旧 → 内容未变则幂等（不归档/不升版本）→ 有变则归档旧版并以 +1 版本覆盖
async function upsertLocked(batchNo, cleanRecord, authUid) {
    const id = docId(batchNo)
    for (let attempt = 0; attempt < 5; attempt++) {
        const oldRes = await db.collection(COLL).doc(id).get()
        const old = (oldRes && oldRes.data && oldRes.data[0]) || null

        // 首次保存：无旧记录，建 v1
        if (!old) {
            const data = Object.assign({}, cleanRecord, {
                batchNo, version: 1, updatedAt: Date.now(), savedBy: authUid
            })
            try {
                await db.collection(COLL).add(Object.assign({}, data, { _id: id }))
                return { _id: id, batchNo, version: 1, unchanged: false }
            } catch (e) {
                continue
            }
        }

        // 内容无变化：不归档、不升版本（避免历史出现重复版本），仅刷新 updatedAt/savedBy 后返回
        if (contentEqual(old, cleanRecord)) {
            try {
                await db.collection(COLL).where({ _id: id, version: old.version })
                    .update({ updatedAt: Date.now(), savedBy: authUid })
            } catch (e) { /* 幂等刷新失败不影响结果 */ }
            return { _id: id, batchNo, version: old.version, unchanged: true }
        }

        // 内容有变化：先归档当前最新版（按现 version），再乐观锁覆盖为 +1 版本
        const newVersion = (old.version || 0) + 1
        await archiveVersion(batchNo, old)
        const data = Object.assign({}, cleanRecord, {
            batchNo, version: newVersion, updatedAt: Date.now(), savedBy: authUid
        })
        const r = await db.collection(COLL).where({ _id: id, version: old.version }).update(data)
        if (await updateApplied(id, newVersion, cleanRecord, r)) {
            return { _id: id, batchNo, version: newVersion, unchanged: false }
        }
        // 乐观锁冲突：重试
    }
    throw new ClientError('并发保存冲突，请重试', 409)
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

        // 游标分页：按 updatedAt 倒序，before 传上一页末尾的 updatedAt 游标（替代 skip 全表扫）
        if (action === 'list') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const limit = Math.min(Math.max(1, Number(event.limit) || 50), 100)
            const before = Number(event.before)
            let q = db.collection(COLL)
                .field({ batchNo: true, updatedAt: true })
                .orderBy('updatedAt', 'desc')
                .limit(limit + 1)
            if (Number.isFinite(before) && before > 0) {
                q = q.where({ updatedAt: db.command.lt(before) })
            }
            const res = await q.get()
            const rows = (res && res.data) || []
            const hasMore = rows.length > limit
            const page = rows.slice(0, limit)
            return ok({
                list: page,
                hasMore,
                nextBefore: page.length ? page[page.length - 1].updatedAt : (before || 0)
            })
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
                    if (await updateApplied(id, newVersion, snapshot, r)) {
                        return ok({ _id: id, batchNo, version: newVersion })
                    }
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
            const deviceId = normalizeDeviceId(event.deviceId)
            const record = (event.record && typeof event.record === 'object') ? event.record : {}
            const batchNo = normalizeBatchNo(record.batchNo)
            await db.collection(DRAFT_COLL).doc(draftId(auth.uid, deviceId, batchNo)).set({
                uid: auth.uid,
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
            const deviceId = normalizeDeviceId(event.deviceId)
            const batchNo = normalizeBatchNo(event.batchNo)
            const res = await db.collection(DRAFT_COLL).doc(draftId(auth.uid, deviceId, batchNo)).get()
            const rows = (res && res.data) || []
            return ok(rows.length ? rows[0] : null)
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        if (e && e.name === 'ClientError') return fail(e.code || 500, e.message)
        console.error('[production-records] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
