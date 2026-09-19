'use strict'

// 云函数：uni-auth（自包含）
// 用途：用户名密码登录鉴权 + 管理员建号 + token 签发/校验。
//
// 安全说明：
//   - 密钥不再硬编码。tokenSecret 从环境变量 MES_TOKEN_SECRET 读取（云函数控制台配置）。
//   - 密码存储改用 scrypt 加盐哈希（格式 scrypt$<salt>$<hash>），替代无盐 sha256。
//   - 旧格式（无盐 sha256(password:legacySecret)）在登录时仍可验证，验证通过即透明迁移到 scrypt；
//     迁移用 MES_LEGACY_PASSWORD_SECRET 环境变量（值 = 旧 passwordSecret），全部用户登录一轮后可删除该变量。
//
// 调用：uniCloud.callFunction({ name: 'uni-auth', data: { action, ... } })
//   action = 'init' / 'login' / 'createUser' / 'checkLogin' / 'listUsers' / 'deleteUser' / 'setUserStatus'

const crypto = require('crypto')
const { promisify } = require('util')
const scrypt = promisify(crypto.scrypt)

const COLL = 'uni-id-users'
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000 // 7 天
const LOGIN_FAIL_LIMIT = 5                 // 连续失败次数阈值
const LOGIN_LOCK_MS = 15 * 60 * 1000       // 达到阈值后锁定 15 分钟

// 延迟初始化数据库：避免在模块顶层调用 uniCloud.database() 导致支付宝云在模块加载阶段直接崩溃
let _db = null
function getDb() {
    if (!_db) _db = uniCloud.database()
    return _db
}

// 从环境变量读取密钥（未配置返回 error，不抛顶层异常）
function getSecrets() {
    const tokenSecret = process.env.MES_TOKEN_SECRET
    if (!tokenSecret) {
        return { error: '服务端未配置环境变量 MES_TOKEN_SECRET，请在云函数控制台配置后重试' }
    }
    return {
        tokenSecret,
        legacyPasswordSecret: process.env.MES_LEGACY_PASSWORD_SECRET || ''
    }
}

// ---------- 密码（scrypt 加盐） ----------
const SCRYPT_KEYLEN = 64
async function scryptHex(password, salt) {
    const buf = await scrypt(String(password), salt, SCRYPT_KEYLEN)
    return buf.toString('hex')
}
// 生成新密码哈希：scrypt$<salt16hex>$<hash64hex>
async function makePassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = await scryptHex(password, salt)
    return 'scrypt$' + salt + '$' + hash
}
// 校验密码。返回 { ok, needsMigrate }（needsMigrate=true 表示命中旧格式，应透明升级）
async function verifyPassword(password, stored, legacySecret) {
    if (!stored) return { ok: false, needsMigrate: false }
    if (stored.indexOf('scrypt$') === 0) {
        const parts = stored.split('$')
        if (parts.length !== 3) return { ok: false, needsMigrate: false }
        const hash = await scryptHex(password, parts[1])
        return { ok: hash === parts[2], needsMigrate: false }
    }
    // 旧格式：无盐 sha256(password:legacySecret)
    if (legacySecret) {
        const legacy = crypto.createHash('sha256').update(String(password) + ':' + legacySecret).digest('hex')
        if (stored === legacy) return { ok: true, needsMigrate: true }
    }
    return { ok: false, needsMigrate: false }
}

// ---------- token ----------
function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/')
    while (str.length % 4) str += '='
    return Buffer.from(str, 'base64')
}

// 签发 token：payload.signature（payload 为 base64url(JSON)，signature 为 HMAC-SHA256(payload)）
function createToken(payloadObj, tokenSecret) {
    const iat = Date.now()
    const exp = iat + TOKEN_TTL_MS
    const payload = Object.assign({ iat, exp, client: 'mes' }, payloadObj)
    const payloadStr = b64urlEncode(Buffer.from(JSON.stringify(payload)))
    const sig = b64urlEncode(crypto.createHmac('sha256', tokenSecret).update(payloadStr).digest())
    return { token: payloadStr + '.' + sig, tokenExpired: exp }
}

// 校验 token：返回 payload（成功）或 { errCode, message }
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

// 生成随机初始密码（hex，安全随机）
function randomPassword(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len)
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        const secrets = getSecrets()
        if (secrets.error) return { code: 500, message: secrets.error }
        const db = getDb()

        // 首次初始化：用户表为空时创建 admin
        if (action === 'init') {
            const countRes = await db.collection(COLL).count()
            if (countRes.total > 0) return { code: 1, message: '已初始化，勿重复执行' }
            const username = String(event.username || 'admin').trim()
            let password = String(event.password || '').trim()
            const generated = !password
            if (generated) password = randomPassword(12)
            if (password.length < 8) return { code: 400, message: '初始密码至少 8 位' }
            await db.collection(COLL).add({
                username,
                password: await makePassword(password),
                nickname: event.nickname || '管理员',
                role: ['admin'],
                status: 1,
                register_date: Date.now()
            })
            return {
                code: 0,
                message: '初始化成功，账号：' + username,
                initPassword: generated ? password : undefined
            }
        }

        // 登录（含防爆破：连续失败 LOGIN_FAIL_LIMIT 次锁定）
        if (action === 'login') {
            const username = String(event.username || '').trim()
            const password = String(event.password || '')
            if (!username || !password) return { code: 400, message: '请输入账号和密码' }
            const res = await db.collection(COLL).where({ username }).get()
            const user = res.data && res.data[0]
            if (!user) return { code: 401, message: '账号不存在' }
            if (user.status !== 1) return { code: 403, message: '账号已禁用' }

            // 锁定检查
            const lockUntil = Number(user.lockUntil) || 0
            if (lockUntil && Date.now() < lockUntil) {
                const mins = Math.ceil((lockUntil - Date.now()) / 60000)
                return { code: 423, message: '登录失败次数过多，请 ' + mins + ' 分钟后再试' }
            }

            const v = await verifyPassword(password, user.password, secrets.legacyPasswordSecret)
            if (!v.ok) {
                // 失败计数与锁定
                const failCount = (Number(user.loginFailCount) || 0) + 1
                const upd = { loginFailCount: failCount }
                if (failCount >= LOGIN_FAIL_LIMIT) {
                    upd.loginFailCount = 0
                    upd.lockUntil = Date.now() + LOGIN_LOCK_MS
                }
                try { await db.collection(COLL).doc(user._id).update(upd) } catch (e) {}
                const remain = Math.max(0, LOGIN_FAIL_LIMIT - failCount)
                return { code: 401, message: '密码错误' + (remain > 0 ? '（剩余 ' + remain + ' 次机会）' : '') }
            }

            // 登录成功：重置失败计数 + 旧格式密码透明迁移到 scrypt
            const resetUpd = { loginFailCount: 0, lockUntil: 0 }
            if (v.needsMigrate) {
                try { resetUpd.password = await makePassword(password) } catch (e) {}
            }
            try { await db.collection(COLL).doc(user._id).update(resetUpd) } catch (e) {}

            const t = createToken({ uid: user._id, role: user.role }, secrets.tokenSecret)
            return {
                code: 0,
                token: t.token,
                tokenExpired: t.tokenExpired,
                uid: user._id,
                nickname: user.nickname || user.username,
                role: user.role || []
            }
        }

        // 建号（需 admin 登录）
        if (action === 'createUser') {
            const payload = checkToken(event.uniIdToken, secrets.tokenSecret)
            if (payload.errCode) return { code: 401, message: '未登录或登录失效' }
            const roles = payload.role || []
            if (roles.indexOf('admin') < 0) return { code: 403, message: '无权限建号' }
            const username = String(event.username || '').trim()
            const password = String(event.password || '')
            if (!username || !password) return { code: 400, message: '请输入账号和密码' }
            if (password.length < 6) return { code: 400, message: '密码至少 6 位' }
            const exist = await db.collection(COLL).where({ username }).get()
            if (exist.data && exist.data.length) return { code: 409, message: '账号已存在' }
            await db.collection(COLL).add({
                username,
                password: await makePassword(password),
                nickname: event.nickname || username,
                role: ['user'],
                status: 1,
                register_date: Date.now()
            })
            return { code: 0, message: '创建成功' }
        }

        // 校验登录状态（吊销：查用户表验证账号有效，返回数据库最新角色）
        if (action === 'checkLogin') {
            const payload = checkToken(event.uniIdToken, secrets.tokenSecret)
            if (payload.errCode) return { code: 401, message: '未登录或登录失效' }
            if (!payload.uid) return { code: 401, message: 'token 缺少 uid' }
            const res = await db.collection(COLL).doc(payload.uid).get()
            const u = (res && res.data && res.data[0]) || null
            if (!u || u.status !== 1) return { code: 401, message: '账号已失效，请重新登录' }
            return { code: 0, uid: u._id, role: u.role || [] }
        }

        // 用户列表（需 admin）
        if (action === 'listUsers') {
            const payload = checkToken(event.uniIdToken, secrets.tokenSecret)
            if (payload.errCode) return { code: 401, message: '未登录或登录失效' }
            if ((payload.role || []).indexOf('admin') < 0) return { code: 403, message: '无权限' }
            const res = await db.collection(COLL).orderBy('register_date', 'asc').limit(200).get()
            const list = (res.data || []).map(u => ({
                _id: u._id,
                username: u.username,
                nickname: u.nickname || u.username,
                role: u.role || [],
                status: u.status,
                register_date: u.register_date || null
            }))
            return { code: 0, list }
        }

        // 删除用户（需 admin，不能删自己）
        if (action === 'deleteUser') {
            const payload = checkToken(event.uniIdToken, secrets.tokenSecret)
            if (payload.errCode) return { code: 401, message: '未登录或登录失效' }
            if ((payload.role || []).indexOf('admin') < 0) return { code: 403, message: '无权限' }
            const username = String(event.username || '').trim()
            if (!username) return { code: 400, message: '缺少 username' }
            const exist = await db.collection(COLL).where({ username }).get()
            const u = exist.data && exist.data[0]
            if (!u) return { code: 404, message: '账号不存在' }
            if (u._id === payload.uid) return { code: 400, message: '不能删除自己' }
            await db.collection(COLL).doc(u._id).remove()
            return { code: 0, message: '已删除' }
        }

        // 启用/禁用用户（需 admin，不能禁用自己）
        if (action === 'setUserStatus') {
            const payload = checkToken(event.uniIdToken, secrets.tokenSecret)
            if (payload.errCode) return { code: 401, message: '未登录或登录失效' }
            if ((payload.role || []).indexOf('admin') < 0) return { code: 403, message: '无权限' }
            const username = String(event.username || '').trim()
            if (!username) return { code: 400, message: '缺少 username' }
            const status = (event.status === 0 || event.status === '0') ? 0 : 1
            const exist = await db.collection(COLL).where({ username }).get()
            const u = exist.data && exist.data[0]
            if (!u) return { code: 404, message: '账号不存在' }
            if (u._id === payload.uid && status === 0) return { code: 400, message: '不能禁用自己' }
            await db.collection(COLL).doc(u._id).update({ status })
            return { code: 0, message: status === 1 ? '已启用' : '已禁用' }
        }

        return { code: 400, message: '未知 action: ' + action }
    } catch (e) {
        console.error('[uni-auth] 运行异常:', e && (e.stack || e.message || e))
        return { code: 500, message: '内部错误: ' + (e && (e.message || e.errMsg) || JSON.stringify(e)) }
    }
}
