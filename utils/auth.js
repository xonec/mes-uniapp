// 登录鉴权封装（uni-app 官方 uni-id）
// 登录/建号/改密/重置/禁用/注销全部走云对象 uni-id-co；token 存 storage 键 uni_id_token
// （uniCloud SDK 约定键名），并同步到旧键 uniIdToken 兼容云函数显式传参。

const TOKEN_KEY = 'uni_id_token'
const USER_KEY = 'mes_user'

function uniIdCo() {
    if (typeof uniCloud === 'undefined' || !uniCloud.importObject) {
        throw new Error('uniCloud 未初始化')
    }
    return uniCloud.importObject('uni-id-co', { customUI: true })
}

export function getToken() {
    return uni.getStorageSync(TOKEN_KEY)
}

export function getUser() {
    return uni.getStorageSync(USER_KEY) || null
}

function setToken(token) {
    uni.setStorageSync(TOKEN_KEY, token)
    uni.setStorageSync('uniIdToken', token) // 兼容旧版 key
}

function clearToken() {
    uni.removeStorageSync(TOKEN_KEY)
    uni.removeStorageSync('uniIdToken')
}

// 统一处理 uni-id-co 业务结果：errCode 0 通过；token 失效清态跳登录；其余抛错
function assertOk(res) {
    if (res && res.errCode === 0) return
    const code = res && res.errCode
    if (code === 'uni-id-token-expired' || code === 'uni-id-check-token-failed' || code === 30203 || code === 30202) {
        logout()
        uni.reLaunch({ url: '/pages/login/login' })
        throw new Error((res && res.errMsg) || '登录已失效，请重新登录')
    }
    throw new Error((res && res.errMsg) || '操作失败')
}

// 登录，成功返回 { uid, nickname, role }
export async function login(username, password) {
    const res = await uniIdCo().login({ username, password })
    assertOk(res)
    setToken(res.newToken && res.newToken.token)
    // 登录接口不返回 role/nickname，走 user-admin profile 拉取（失败则用兜底值）
    const info = await checkLogin().catch(() => null)
    const user = {
        uid: res.uid,
        nickname: (info && info.nickname) || username,
        role: (info && info.role) || []
    }
    uni.setStorageSync(USER_KEY, user)
    return user
}

export function logout() {
    clearToken()
    uni.removeStorageSync(USER_KEY)
}

export function isLoggedIn() {
    return !!getToken()
}

// 云端校验登录态并取最新角色/昵称；无效返回 null（401 时清态跳登录）
export async function checkLogin() {
    if (!getToken()) return null
    try {
        const res = await uniCloud.callFunction({
            name: 'user-admin',
            data: { action: 'profile', uniIdToken: getToken() }
        })
        const r = res && res.result
        if (r && r.code === 0) return r.data
        if (r && r.code === 401) { logout(); uni.reLaunch({ url: '/pages/login/login' }) }
        return null
    } catch (e) {
        return null
    }
}

// 修改本人密码（uni-id-co updatePwd）
export async function changePassword(oldPassword, newPassword) {
    const res = await uniIdCo().updatePwd({ oldPassword, newPassword })
    assertOk(res)
}

// 管理员重置他人密码（uni-id-co updateUser，需 admin）
export async function resetPassword(uid, newPassword) {
    const res = await uniIdCo().updateUser({ id: uid, password: newPassword })
    assertOk(res)
}

// 管理员新增用户（uni-id-co addUser）
export async function addUser(params) {
    const res = await uniIdCo().addUser(params)
    assertOk(res)
}

// 管理员更新用户（uni-id-co updateUser：禁用/启用/重置密码/改角色等）
export async function updateUser(params) {
    const res = await uniIdCo().updateUser(params)
    assertOk(res)
}
