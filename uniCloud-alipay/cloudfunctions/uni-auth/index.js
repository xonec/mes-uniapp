'use strict'

// 云函数：uni-auth
// 用途：用户名密码登录鉴权 + 管理员建号 + token 签发/校验。
//
// 安全说明：
//   - token 签发/校验、鉴权工具来自公共模块 mes-common；tokenSecret 从环境变量 MES_TOKEN_SECRET 读取。
//   - 密码存储用 scrypt 加盐哈希（scrypt$<salt>$<hash>）。
//   - 旧格式（无盐 sha256）登录时自动兼容并透明迁移，迁移用 MES_LEGACY_PASSWORD_SECRET 环境变量。
//   - 登录防爆破：连续失败 5 次锁定 15 分钟。
//
// 调用：uniCloud.callFunction({ name: 'uni-auth', data: { action, ... } })
//   action = 'init' / 'login' / 'createUser' / 'checkLogin' / 'listUsers' / 'deleteUser' / 'setUserStatus'
//          / 'changePassword'(本人改密) / 'resetPassword'(管理员重置他人)
//   token 载荷含 pv(pwdVersion)；改密/重置后 pwdVersion+1，旧 token 立即失效（需重新登录）。

const crypto = require('crypto')
const { promisify } = require('util')
const scrypt = promisify(crypto.scrypt)

const { createToken, checkToken, getTokenSecret, ok, fail } = require('mes-common')

const COLL = 'uni-id-users'
const LOGIN_FAIL_LIMIT = 5                 // 连续失败次数阈值
const LOGIN_LOCK_MS = 15 * 60 * 1000       // 达到阈值后锁定 15 分钟

// token 中的密码版本是否与用户当前一致（改密后旧 token 立即失效）
function pwdVersionOk(user, payload) {
    return Number(user && user.pwdVersion || 1) === Number(payload && payload.pv || 1)
}

// 延迟初始化数据库：避免在模块顶层调用 uniCloud.database() 导致支付宝云在模块加载阶段直接崩溃
let _db = null
function getDb() {
    if (!_db) _db = uniCloud.database()
    return _db
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

// 生成随机初始密码（hex，安全随机）
function randomPassword(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len)
}

// 归一化角色：只接受 'user' / 'admin'，非法值一律降级为 ['user']。
// 调用方（createUser）已通过 requireAdmin 鉴权，故此处允许授予 admin。
function normalizeRole(input) {
    let arr = []
    if (Array.isArray(input)) arr = input
    else if (typeof input === 'string' && input) arr = [input]
    const out = arr.filter(r => r === 'user' || r === 'admin')
    if (!out.length) out.push('user')
    return Array.from(new Set(out))
}

// 管理员鉴权：验 token + 查用户表验证 status 与 admin 角色（禁用/降级即时生效）
async function requireAdmin(db, token, tokenSecret) {
    const payload = checkToken(token, tokenSecret)
    if (payload.errCode) return { errCode: 401, message: '未登录或登录失效' }
    if (!payload.uid) return { errCode: 401, message: 'token 缺少 uid' }
    const res = await db.collection(COLL).doc(payload.uid).get()
    const u = (res && res.data && res.data[0]) || null
    if (!u || u.status !== 1) return { errCode: 401, message: '账号已失效，请重新登录' }
    if (!pwdVersionOk(u, payload)) return { errCode: 401, message: '密码已变更，请重新登录' }
    if ((u.role || []).indexOf('admin') < 0) return { errCode: 403, message: '无权限' }
    return { errCode: 0, uid: u._id }
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        const tokenSecret = getTokenSecret()
        if (!tokenSecret) return fail(500, '服务端未配置环境变量 MES_TOKEN_SECRET')
        const legacyPasswordSecret = process.env.MES_LEGACY_PASSWORD_SECRET || ''
        const db = getDb()

        // 首次初始化：用户表为空时创建 admin
        if (action === 'init') {
            const countRes = await db.collection(COLL).count()
            if (countRes.total > 0) return fail(1, '已初始化，勿重复执行')
            const username = String(event.username || 'admin').trim()
            let password = String(event.password || '').trim()
            const generated = !password
            if (generated) password = randomPassword(12)
            if (password.length < 8) return fail(400, '初始密码至少 8 位')
            await db.collection(COLL).add({
                username,
                password: await makePassword(password),
                nickname: event.nickname || '管理员',
                role: ['admin'],
                status: 1,
                pwdVersion: 1,
                register_date: Date.now()
            })
            return ok(generated ? { username, initPassword: password } : { username })
        }

        // 登录（含防爆破）
        if (action === 'login') {
            const username = String(event.username || '').trim()
            const password = String(event.password || '')
            if (!username || !password) return fail(400, '请输入账号和密码')
            const res = await db.collection(COLL).where({ username }).get()
            const user = res.data && res.data[0]
            if (!user) return fail(401, '账号不存在')
            if (user.status !== 1) return fail(403, '账号已禁用')

            const lockUntil = Number(user.lockUntil) || 0
            if (lockUntil && Date.now() < lockUntil) {
                const mins = Math.ceil((lockUntil - Date.now()) / 60000)
                return fail(423, '登录失败次数过多，请 ' + mins + ' 分钟后再试')
            }

            const v = await verifyPassword(password, user.password, legacyPasswordSecret)
            if (!v.ok) {
                const failCount = (Number(user.loginFailCount) || 0) + 1
                const upd = { loginFailCount: failCount }
                if (failCount >= LOGIN_FAIL_LIMIT) {
                    upd.loginFailCount = 0
                    upd.lockUntil = Date.now() + LOGIN_LOCK_MS
                }
                try { await db.collection(COLL).doc(user._id).update(upd) } catch (e) {}
                const remain = Math.max(0, LOGIN_FAIL_LIMIT - failCount)
                return fail(401, '密码错误' + (remain > 0 ? '（剩余 ' + remain + ' 次机会）' : ''))
            }

            // 登录成功：重置失败计数 + 旧格式密码透明迁移
            const resetUpd = { loginFailCount: 0, lockUntil: 0 }
            if (v.needsMigrate) {
                try { resetUpd.password = await makePassword(password) } catch (e) {}
            }
            try { await db.collection(COLL).doc(user._id).update(resetUpd) } catch (e) {}

            const t = createToken({ uid: user._id, role: user.role, pv: Number(user.pwdVersion || 1) }, tokenSecret)
            return ok({
                token: t.token,
                tokenExpired: t.tokenExpired,
                uid: user._id,
                nickname: user.nickname || user.username,
                role: user.role || []
            })
        }

        // 建号（需 admin）。role 由调用方指定，仅接受 user / admin，缺省 user。
        if (action === 'createUser') {
            const auth = await requireAdmin(db, event.uniIdToken, tokenSecret)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const username = String(event.username || '').trim()
            const password = String(event.password || '')
            if (!username || !password) return fail(400, '请输入账号和密码')
            if (!/^\S{2,32}$/.test(username)) return fail(400, '账号须为 2-32 位且不含空格')
            if (password.length < 6) return fail(400, '密码至少 6 位')
            const role = normalizeRole(event.role)
            const exist = await db.collection(COLL).where({ username }).get()
            if (exist.data && exist.data.length) return fail(409, '账号已存在')
            await db.collection(COLL).add({
                username,
                password: await makePassword(password),
                nickname: event.nickname || username,
                role,
                status: 1,
                pwdVersion: 1,
                register_date: Date.now()
            })
            return ok({ username, role })
        }

        // 本人修改密码（需登录 + 校验原密码）；成功后返回新 token，其它设备旧 token 失效。
        if (action === 'changePassword') {
            const payload = checkToken(event.uniIdToken, tokenSecret)
            if (payload.errCode) return fail(401, '未登录或登录失效')
            if (!payload.uid) return fail(401, 'token 缺少 uid')
            const oldPassword = String(event.oldPassword || '')
            const newPassword = String(event.newPassword || '')
            if (!oldPassword || !newPassword) return fail(400, '请输入原密码与新密码')
            if (newPassword.length < 6) return fail(400, '新密码至少 6 位')
            if (newPassword === oldPassword) return fail(400, '新密码不能与原密码相同')

            const res = await db.collection(COLL).doc(payload.uid).get()
            const u = (res && res.data && res.data[0]) || null
            if (!u || u.status !== 1) return fail(401, '账号已失效，请重新登录')
            if (!pwdVersionOk(u, payload)) return fail(401, '密码已变更，请重新登录')

            const v = await verifyPassword(oldPassword, u.password, legacyPasswordSecret)
            if (!v.ok) return fail(401, '原密码错误')

            const pwdVersion = Number(u.pwdVersion || 1) + 1
            await db.collection(COLL).doc(u._id).update({
                password: await makePassword(newPassword),
                pwdVersion,
                loginFailCount: 0,
                lockUntil: 0
            })
            const t = createToken({ uid: u._id, role: u.role || [], pv: pwdVersion }, tokenSecret)
            return ok({
                token: t.token,
                tokenExpired: t.tokenExpired,
                uid: u._id,
                nickname: u.nickname || u.username,
                role: u.role || []
            })
        }

        // 管理员重置他人密码（需 admin；自己请用 changePassword）
        if (action === 'resetPassword') {
            const auth = await requireAdmin(db, event.uniIdToken, tokenSecret)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const username = String(event.username || '').trim()
            const newPassword = String(event.newPassword || '')
            if (!username || !newPassword) return fail(400, '缺少账号或新密码')
            if (newPassword.length < 6) return fail(400, '新密码至少 6 位')
            const exist = await db.collection(COLL).where({ username }).get()
            const u = exist.data && exist.data[0]
            if (!u) return fail(404, '账号不存在')
            if (u._id === auth.uid) return fail(400, '请用「修改我的密码」修改自己的密码')
            await db.collection(COLL).doc(u._id).update({
                password: await makePassword(newPassword),
                pwdVersion: Number(u.pwdVersion || 1) + 1,
                loginFailCount: 0,
                lockUntil: 0
            })
            return ok({ username })
        }

        // 校验登录状态（吊销：查用户表，返回数据库最新角色）
        if (action === 'checkLogin') {
            const payload = checkToken(event.uniIdToken, tokenSecret)
            if (payload.errCode) return fail(401, '未登录或登录失效')
            if (!payload.uid) return fail(401, 'token 缺少 uid')
            const res = await db.collection(COLL).doc(payload.uid).get()
            const u = (res && res.data && res.data[0]) || null
            if (!u || u.status !== 1) return fail(401, '账号已失效，请重新登录')
            if (!pwdVersionOk(u, payload)) return fail(401, '密码已变更，请重新登录')
            return ok({ uid: u._id, role: u.role || [] })
        }

        // 用户列表（需 admin）
        if (action === 'listUsers') {
            const auth = await requireAdmin(db, event.uniIdToken, tokenSecret)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const res = await db.collection(COLL).orderBy('register_date', 'asc').limit(200).get()
            const list = (res.data || []).map(u => ({
                _id: u._id,
                username: u.username,
                nickname: u.nickname || u.username,
                role: u.role || [],
                status: u.status,
                register_date: u.register_date || null
            }))
            return ok({ list })
        }

        // 删除用户（需 admin，不能删自己）
        if (action === 'deleteUser') {
            const auth = await requireAdmin(db, event.uniIdToken, tokenSecret)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const username = String(event.username || '').trim()
            if (!username) return fail(400, '缺少 username')
            const exist = await db.collection(COLL).where({ username }).get()
            const u = exist.data && exist.data[0]
            if (!u) return fail(404, '账号不存在')
            if (u._id === auth.uid) return fail(400, '不能删除自己')
            await db.collection(COLL).doc(u._id).remove()
            return ok()
        }

        // 启用/禁用用户（需 admin，不能禁用自己）
        if (action === 'setUserStatus') {
            const auth = await requireAdmin(db, event.uniIdToken, tokenSecret)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const username = String(event.username || '').trim()
            if (!username) return fail(400, '缺少 username')
            const status = (event.status === 0 || event.status === '0') ? 0 : 1
            const exist = await db.collection(COLL).where({ username }).get()
            const u = exist.data && exist.data[0]
            if (!u) return fail(404, '账号不存在')
            if (u._id === auth.uid && status === 0) return fail(400, '不能禁用自己')
            await db.collection(COLL).doc(u._id).update({ status })
            return ok()
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[uni-auth] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '内部错误: ' + (e && (e.message || e.errMsg) || JSON.stringify(e)))
    }
}
