'use strict'

// 云函数：batch-buckets（自包含）
// 用途：batch_buckets 集合的受控读写入口（读写均走云函数并鉴权，客户端不直连数据库）。
//   action = 'upsert'：幂等写入/更新某批号分桶件数（固定 _id = batch:<批号>）
//   action = 'get'   ：读取某批号分桶件数（需登录）
// 密钥从环境变量 MES_TOKEN_SECRET 读取，不再硬编码到源码。

const crypto = require('crypto')

const COLL = 'batch_buckets'
const USER_COLL = 'uni-id-users'
const BUCKET_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃（无法被 try/catch 捕获）
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

// ---------- token 校验（与 uni-auth 同算法，密钥从环境变量读取） ----------
function b64urlDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/')
    while (str.length % 4) str += '='
    return Buffer.from(str, 'base64')
}
function checkToken(token, tokenSecret) {
    if (!token || typeof token !== 'string') return { errCode: 'TOKEN_INVALID', message: '未登录' }
    const parts = String(token).split('.')
    if (parts.length !== 2) return { errCode: 'TOKEN_INVALID', message: 'token 格式错误' }
    const [payloadStr, sig] = parts
    const expectedSig = Buffer.from(crypto.createHmac('sha256', tokenSecret).update(payloadStr).digest())
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    if (sig !== expectedSig) return { errCode: 'TOKEN_INVALID', message: '签名校验失败' }
    let payload
    try {
        payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8'))
    } catch (e) {
        return { errCode: 'TOKEN_INVALID', message: 'token 解析失败' }
    }
    const now = Date.now()
    if (payload.exp && now > payload.exp) return { errCode: 'TOKEN_EXPIRED', message: '登录已过期' }
    return payload
}

// 鉴权：校验登录态 + 查用户表验证账号有效（禁用/删除后 token 立即失效），返回 { errCode, uid }
async function checkAuth(token, tokenSecret) {
    if (!token) return { errCode: 401, message: '未登录' }
    const payload = checkToken(token, tokenSecret)
    if (payload.errCode) return { errCode: 401, message: '登录失效，请重新登录' }
    if (!payload.uid) return { errCode: 401, message: 'token 缺少 uid' }
    try {
        const res = await db.collection(USER_COLL).doc(payload.uid).get()
        const u = (res && res.data && res.data[0]) || null
        if (!u || u.status !== 1) return { errCode: 401, message: '账号已失效，请重新登录' }
    } catch (e) {
        console.warn('[checkAuth] 查用户状态失败：', e && e.message)
    }
    return { errCode: 0, uid: payload.uid }
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
        const r = await coll.doc(id).update(data)
        updated = (r && (r.updated || (r.result && (r.result.updated || r.result.affectedDocs)))) || 0
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
        const tokenSecret = process.env.MES_TOKEN_SECRET
        if (!tokenSecret) return { code: 500, message: '服务端未配置环境变量 MES_TOKEN_SECRET' }

        if (action === 'upsert') {
            const auth = await checkAuth(event.uniIdToken, tokenSecret)
            if (auth.errCode) return { code: 401, message: auth.message }
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
            return { ok: true, _id: id, batchNo, buckets }
        }

        if (action === 'get') {
            const auth = await checkAuth(event.uniIdToken, tokenSecret)
            if (auth.errCode) return { code: 401, message: auth.message }
            const batchNo = normalizeBatchNo(event.batchNo)
            let res = await db.collection(COLL).doc(docId(batchNo)).get()
            let rows = (res && res.data) || []
            if (!rows.length) {
                // 兼容旧数据（旧文档无固定 _id，按 batchNo 字段查）
                const r2 = await db.collection(COLL).where({ batchNo }).get()
                rows = (r2 && r2.data) || []
            }
            return rows.length ? rows[0] : null
        }

        throw new Error('未知 action: ' + action)
    } catch (e) {
        console.error('[batch-buckets] 运行异常:', e && (e.stack || e.message || e))
        throw e
    }
}
