// 云函数统一调用封装（production-db / cloud-db / user-manage 共用，消除重复实现）
//
// 约定：所有云函数返回统一协议 { code, message, data }
//   - code 0      成功，返回 data
//   - code 401    未登录/登录失效 → 清本地登录态并跳登录页，然后抛错
//   - 其它非 0    抛错（message 可直接展示）
//
// 自动附带 uniIdToken（来自本地 storage），调用方无需关心。
// 系统级失败（云函数超时/断网等）会进入 callFunction 的 fail 回调，拿不到业务返回；
// 这里统一转成可读文案，并保留 requestId / 原始 errMsg 便于查云端日志。

import { getToken, logout } from './auth.js'

const CALL_TIMEOUT = 60000
const OCR_RECOGNIZE_TIMEOUT = 100000   // 服务端识别预算 75s + 网络/收尾余量
const LONG_CALL_TIMEOUT = 210000

function isTransportFailure(raw) {
    if (!raw) return true
    return /request:fail|timeout|timed?\s*out|超时|SYSTEM_ERROR|network|网络/i.test(raw)
}

/** 把 callFunction 的 reject 归一成可读错误：保留 code / requestId / 原始 errMsg。 */
function transportError(name, action, error, elapsedMs) {
    const raw = String((error && (error.errMsg || error.message)) || '').trim()
    const code = (error && (error.code || error.errCode)) || ''
    const requestId = (error && error.requestId) || ''
    const seconds = Math.max(1, Math.round(elapsedMs / 1000))
    console.warn('[cloud-call] ' + name + '/' + action + ' 调用失败 code=' + code + ' requestId=' + requestId + ' errMsg=' + raw)
    const transport = isTransportFailure(raw)
    const subject = name === 'doc-ocr' ? '云端识别' : '云端调用'
    const failure = new Error(transport
        ? subject + '中断（已等待约 ' + seconds + ' 秒，可能超时或网络异常），本次未获得结果，' + (name === 'doc-ocr' ? '请重试或手动录入' : '请稍后重试')
        : '云端调用失败：' + raw)
    failure.kind = transport ? 'timeout' : 'transport'
    failure.code = code
    failure.requestId = requestId
    failure.cause = raw
    return failure
}

export async function callCloud(name, action, payload = {}) {
    if (typeof uniCloud === 'undefined' || !uniCloud.callFunction) {
        throw new Error('uniCloud 未初始化（检查 manifest 的云服务空间配置）')
    }
    const timeout = name === 'doc-ocr' && action === 'recognize'
        ? OCR_RECOGNIZE_TIMEOUT
        : (name === 'production-orders' && action === 'commitSourceImages' ? LONG_CALL_TIMEOUT : CALL_TIMEOUT)
    const startedAt = Date.now()
    let res
    try {
        res = await uniCloud.callFunction({
            name,
            timeout,
            data: Object.assign({ action, uniIdToken: getToken() }, payload)
        })
    } catch (error) {
        throw transportError(name, action, error, Date.now() - startedAt)
    }
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
        const error = new Error(r.message || '云端操作失败')
        error.code = r.code
        throw error
    }
    return r.data
}
