'use strict'
// 公共模块：鉴权（委托 uni-id）+ 统一响应封装（多个云函数共享）
// 位置：uniCloud-alipay/cloudfunctions/common/mes-common
//
// 鉴权已切换为 uni-app 官方 uni-id：token 校验走 uni-id-common 的 checkToken（JWT，HS256）。
// 保留 checkAuth / checkAdmin 签名不变，业务云函数无需改动。
// 依赖公共模块：uni-id-common（→ uni-config-center 读取 uni-id/config.json 的 tokenSecret）。
//
// 差异说明（相对旧自研 HMAC token）：
//   - token 由 uni-id 签发（uni-id-co 登录 / uni-id-common createToken），载荷含 uid/role。
//   - 禁用/封禁、角色变更在下一次登录/刷新时生效（uni-id 语义），不再有自研的 pwdVersion 即时失效。
//   - checkAuth 仍为 fail-closed：查用户表失败返回 503 拒绝，不放行。

const uniID = require('uni-id-common')

const USER_COLL = 'uni-id-users'

// ---------- 面向客户端的业务错误 ----------
class ClientError extends Error {
    constructor(message, code = 500) {
        super(message)
        this.name = 'ClientError'
        this.code = code
    }
}

// uni-id 实例（惰性单例；固定 app 端 clientInfo 读取默认 config）
let _ins = null
function getUniID() {
    if (!_ins) {
        _ins = uniID.createInstance({ clientInfo: { platform: 'app' } })
    }
    return _ins
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

// uni-id status 语义：0/未设置=正常；1=封禁；2=审核中；3=审核失败；4=已注销
function isBlocked(u) {
    const s = u.status
    return s === 1 || s === 2 || s === 3 || s === 4
}

// ---------- 鉴权 ----------
// 验证 token → 返回 { errCode, uid, role }；errCode 0 表示通过（role 为数据库最新角色）。
// fail-closed：查用户表失败返回 503 拒绝，不放行。
async function checkAuth(db, token) {
    if (!token) return { errCode: 401, message: '未登录' }
    let payload
    try {
        const r = await getUniID().checkToken(token, { autoRefresh: false })
        if (r && r.errCode) return { errCode: 401, message: '登录失效，请重新登录' }
        payload = r
    } catch (e) {
        return { errCode: 401, message: '登录失效，请重新登录' }
    }
    if (!payload || !payload.uid) return { errCode: 401, message: 'token 缺少 uid' }

    const { user: u, err } = await loadUserWithRetry(db, payload.uid)
    if (err) {
        console.warn('[checkAuth] 查用户状态失败，拒绝本次请求（fail-closed）：', err && err.message)
        return { errCode: 503, message: '服务暂时不可用，请稍后重试' }
    }
    if (!u) return { errCode: 401, message: '账号不存在' }
    if (isBlocked(u)) return { errCode: 401, message: '账号已失效，请重新登录' }
    // 改密后旧 token 立即失效：签发时间早于 valid_token_date 则拒绝（uni-id 改密/重置会更新该字段）
    if (u.valid_token_date && payload.iat && Number(u.valid_token_date) > Number(payload.iat) * 1000) {
        return { errCode: 401, message: '密码已变更，请重新登录' }
    }
    return { errCode: 0, uid: payload.uid, role: u.role || [] }
}

// 管理员鉴权：验 token + 数据库最新角色含 admin（fail-closed）
async function checkAdmin(db, token) {
    const auth = await checkAuth(db, token)
    if (auth.errCode) return auth
    if ((auth.role || []).indexOf('admin') < 0) return { errCode: 403, message: '无权限' }
    return auth
}

// ---------- 统一响应封装：{ code, message, data } ----------
function ok(data) {
    return { code: 0, message: 'ok', data }
}
function fail(code, message) {
    return { code, message }
}

module.exports = {
    checkAuth, checkAdmin, ok, fail, ClientError, USER_COLL
}
