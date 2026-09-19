// 登录鉴权封装（uni-id 用户名密码）
// token 存 storage，客户端 callFunction 会自动带上（uniCloud SDK 自动读 uni_id_token）

const TOKEN_KEY = 'uni_id_token'
const USER_KEY = 'mes_user'

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

// 登录，成功返回 { uid, nickname, role }
export async function login(username, password) {
    if (typeof uniCloud === 'undefined' || !uniCloud.callFunction) {
        throw new Error('uniCloud 未初始化')
    }
    const res = await uniCloud.callFunction({
        name: 'uni-auth',
        data: { action: 'login', username, password }
    })
    const r = res && res.result
    if (!r || r.code !== 0) {
        throw new Error((r && r.message) || '登录失败')
    }
    const d = r.data || {}
    setToken(d.token)
    const user = { uid: d.uid, nickname: d.nickname, role: d.role || [] }
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

// 云端校验登录状态（带 token 调 checkLogin），有效返回 { uid, role }，无效返回 null
export async function checkLogin() {
    if (!getToken()) return null
    try {
        const res = await uniCloud.callFunction({
            name: 'uni-auth',
            data: { action: 'checkLogin', uniIdToken: getToken() }
        })
        const r = res && res.result
        if (r && r.code === 0) {
            const d = r.data || {}
            return { uid: d.uid, role: d.role || [] }
        }
        return null
    } catch (e) {
        return null
    }
}
