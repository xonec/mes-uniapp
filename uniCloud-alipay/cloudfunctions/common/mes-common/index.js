'use strict'
// 公共模块：token 校验 + 鉴权 + 统一响应封装（3 个云函数共享，消除重复代码）
// 位置：uniCloud-alipay/cloudfunctions/common/mes-common
// 云函数 package.json 依赖："mes-common": "file:../common/mes-common"
// 上传：HBuilderX 上传云函数时需一并上传公共模块（右键 common 目录 → 上传公共模块）。

const crypto = require('crypto')

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000 // token 有效期 7 天
const USER_COLL = 'uni-id-users'

// 密钥从环境变量读取（云函数控制台配置），不再硬编码到源码
function getTokenSecret() {
    return process.env.MES_TOKEN_SECRET || ''
}

// ---------- base64url ----------
function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/')
    while (str.length % 4) str += '='
    return Buffer.from(str, 'base64')
}

// ---------- token ----------
// 签发：payload.signature（payload = base64url(JSON)，signature = HMAC-SHA256(payload)）
function createToken(payloadObj, tokenSecret) {
    const iat = Date.now()
    const exp = iat + TOKEN_TTL_MS
    const payload = Object.assign({ iat, exp, client: 'mes' }, payloadObj)
    const payloadStr = b64urlEncode(Buffer.from(JSON.stringify(payload)))
    const sig = b64urlEncode(crypto.createHmac('sha256', tokenSecret).update(payloadStr).digest())
    return { token: payloadStr + '.' + sig, tokenExpired: exp }
}

// 校验：返回 payload（成功）或 { errCode, message }
function checkToken(token, tokenSecret) {
    if (!token || typeof token !== 'string') return { errCode: 'TOKEN_INVALID', message: '未登录' }
    const parts = String(token).split('.')
    if (parts.length !== 2) return { errCode: 'TOKEN_INVALID', message: 'token 格式错误' }
    const [payloadStr, sig] = parts
    const expected = b64urlEncode(crypto.createHmac('sha256', tokenSecret).update(payloadStr).digest())
    if (sig !== expected) return { errCode: 'TOKEN_INVALID', message: '签名校验失败' }
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

// 读用户记录（带一次重试，降低瞬时抖动导致的误判）
async function loadUserWithRetry(db, uid) {
    let lastErr = null
    for (let i = 0; i < 2; i++) {
        try {
            const res = await db.collection(USER_COLL).doc(uid).get()
            return { user: (res && res.data && res.data[0]) || null, err: null }
        } catch (e) {
            lastErr = e
            if (i === 0) await new Promise(r => setTimeout(r, 150))
        }
    }
    return { user: null, err: lastErr }
}

// ---------- 鉴权（查用户表验证账号有效，禁用/改密后 token 立即失效）----------
// 返回 { errCode, uid }；errCode 0 表示通过。
// 安全取向：**fail-closed** —— 查用户表失败时返回 503 拒绝本次请求，而不是放行。
// 放行会让「已被禁用/已改密」的 token 在数据库抖动期间继续可用；宁可暂时拒绝也不能错放。
// 用 503（而非 401）是为了避免客户端误判为「登录失效」而把用户踢到登录页。
async function checkAuth(db, token) {
    const tokenSecret = getTokenSecret()
    if (!tokenSecret) return { errCode: 500, message: '服务端未配置环境变量 MES_TOKEN_SECRET' }
    if (!token) return { errCode: 401, message: '未登录' }
    const payload = checkToken(token, tokenSecret)
    if (payload.errCode) return { errCode: 401, message: '登录失效，请重新登录' }
    if (!payload.uid) return { errCode: 401, message: 'token 缺少 uid' }

    const { user: u, err } = await loadUserWithRetry(db, payload.uid)
    if (err) {
        console.warn('[checkAuth] 查用户状态失败，拒绝本次请求（fail-closed）：', err && err.message)
        return { errCode: 503, message: '服务暂时不可用，请稍后重试' }
    }
    if (!u || u.status !== 1) return { errCode: 401, message: '账号已失效，请重新登录' }
    // 改密后，签发时间早于改密的旧 token 立即失效（pwdVersion 不匹配）
    if (Number(u.pwdVersion || 1) !== Number(payload.pv || 1)) {
        return { errCode: 401, message: '密码已变更，请重新登录' }
    }
    return { errCode: 0, uid: payload.uid }
}

// ---------- 管理员鉴权：验 token + 查用户表校验 status / pwdVersion / admin 角色 ----------
// 同 checkAuth 一样是 fail-closed：查库失败返回 503，不放行。
async function checkAdmin(db, token) {
    const auth = await checkAuth(db, token)
    if (auth.errCode) return auth
    const { user: u, err } = await loadUserWithRetry(db, auth.uid)
    if (err) {
        console.warn('[checkAdmin] 校验权限失败，拒绝本次请求（fail-closed）：', err && err.message)
        return { errCode: 503, message: '服务暂时不可用，请稍后重试' }
    }
    if (!u || u.status !== 1) return { errCode: 401, message: '账号已失效，请重新登录' }
    if ((u.role || []).indexOf('admin') < 0) return { errCode: 403, message: '无权限' }
    return { errCode: 0, uid: auth.uid }
}

// ---------- 统一响应封装：{ code, message, data } ----------
function ok(data) {
    return { code: 0, message: 'ok', data }
}
function fail(code, message) {
    return { code, message }
}

module.exports = {
    getTokenSecret, createToken, checkToken, checkAuth, checkAdmin, ok, fail,
    b64urlEncode, b64urlDecode, TOKEN_TTL_MS, USER_COLL
}
