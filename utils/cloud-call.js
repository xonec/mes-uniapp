// 云函数统一调用封装（production-db / cloud-db / user-manage 共用，消除重复实现）
//
// 约定：所有云函数返回统一协议 { code, message, data }
//   - code 0      成功，返回 data
//   - code 401    未登录/登录失效 → 清本地登录态并跳登录页，然后抛错
//   - 其它非 0    抛错（message 可直接展示）
//
// 自动附带 uniIdToken（来自本地 storage），调用方无需关心。

import { getToken, logout } from './auth.js'

export async function callCloud(name, action, payload = {}) {
    if (typeof uniCloud === 'undefined' || !uniCloud.callFunction) {
        throw new Error('uniCloud 未初始化（检查 manifest 的云服务空间配置）')
    }
    const res = await uniCloud.callFunction({
        name,
        data: Object.assign({ action, uniIdToken: getToken() }, payload)
    })
    const r = res && res.result
    if (!r || typeof r.code === 'undefined') {
        throw new Error('云端返回异常')
    }
    if (r.code === 401) {
        logout()
        uni.reLaunch({ url: '/pages/login/login' })
        throw new Error(r.message || '登录失效，请重新登录')
    }
    if (r.code !== 0) {
        throw new Error(r.message || '云端操作失败')
    }
    return r.data
}
