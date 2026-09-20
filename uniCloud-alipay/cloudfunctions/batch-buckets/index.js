'use strict'

// 云函数：batch-buckets
// 用途：batch_buckets 集合的受控读写入口（读写均走云函数并鉴权，客户端不直连数据库）。
//   action = 'upsert'：幂等写入/更新某批号分桶件数（固定 _id = batch:<批号>）
//   action = 'get'   ：读取某批号分桶件数（需登录）
// 依赖公共模块 mes-common（token 校验 / 鉴权 / 响应封装）；密钥从环境变量 MES_TOKEN_SECRET 读取。

const { checkAuth, ok, fail } = require('mes-common')

const COLL = 'batch_buckets'
const BUCKET_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃（无法被 try/catch 捕获）
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

function docId(batchNo) {
    return 'batch:' + String(batchNo)
}

function normalizeBatchNo(v) {
    const s = String(v || '').trim().toUpperCase()
    if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(s)) {
        throw new Error('批号非法：须为 11 位且同时含字母与数字')
    }
    return s
}

function normalizeBuckets(v) {
    if (!v || typeof v !== 'object') throw new Error('buckets 缺失或格式错误')
    const out = {}
    BUCKET_KEYS.forEach(k => {
        const n = Number(v[k])
        out[k] = Number.isFinite(n) && n >= 0 ? n : 0
    })
    return out
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

async function upsertDoc(id, data) {
    const coll = db.collection(COLL)
    // 首选 set：upsert 覆盖写，天然幂等
    try {
        await coll.doc(id).set(data)
        return
    } catch (e) { /* 回退 */ }

    // 回退一：update，命中则完成
    let updated = 0
    try {
        updated = updatedCount(await coll.doc(id).update(data))
    } catch (e) { updated = 0 }
    if (updated) return

    // 回退二：add（撞唯一键则再 update，覆盖并发场景）
    try {
        await coll.add(Object.assign({}, data, { _id: id }))
    } catch (e) {
        const msg = String((e && (e.message || e.errMsg)) || e)
        if (/duplicate|exist|already/i.test(msg)) {
            await coll.doc(id).update(data)
        } else {
            throw e
        }
    }
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        db = getDb()

        if (action === 'upsert') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = normalizeBatchNo(event.batchNo)
            const buckets = normalizeBuckets(event.buckets)
            const id = docId(batchNo)
            const data = {
                batchNo,
                buckets,
                updatedAt: Date.now(),
                sourceFetchedAt: event.sourceFetchedAt || null,
                checksum: event.checksum || null,
                savedBy: auth.uid
            }
            await upsertDoc(id, data)
            return ok({ _id: id, batchNo, buckets })
        }

        if (action === 'get') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = normalizeBatchNo(event.batchNo)
            let res = await db.collection(COLL).doc(docId(batchNo)).get()
            let rows = (res && res.data) || []
            if (!rows.length) {
                // 兼容旧数据（旧文档无固定 _id，按 batchNo 字段查）
                const r2 = await db.collection(COLL).where({ batchNo }).get()
                rows = (r2 && r2.data) || []
            }
            return ok(rows.length ? rows[0] : null)
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[batch-buckets] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '内部错误: ' + (e && (e.message || e.errMsg) || JSON.stringify(e)))
    }
}
