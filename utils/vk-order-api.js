// P2 批 5：指令单链路的 vk 数据层适配。
//
// 旧页面通过 callCloud(name, action, payload) 调三个业务云函数；新页统一改成
// vk.callFunction → router facade（mes/pub/order|ocr|materials）。返回值同样是业务 data，
// 所以这里导出与 callCloud 同签名的 callCloud，页面/组件/ocr-client 无需改调用方式。
import { vkCall } from '@/utils/vk-operations.js'
import { callCloud as directCallCloud } from '@/utils/cloud-call.js'
import { getToken, logout } from '@/utils/auth.js'

const ROUTES = {
    'production-orders': 'mes/pub/orders',
    'doc-ocr': 'mes/pub/ocr',
    'product-materials': 'mes/pub/materials'
}

/** 与 utils/cloud-call.js 完全一致的超时口径（识别 100s、原图提交 210s，其余 60s）。 */
const CALL_TIMEOUT = 60000
const OCR_RECOGNIZE_TIMEOUT = 100000
const LONG_CALL_TIMEOUT = 210000
const TIMEOUTS = {
    'doc-ocr:recognize': OCR_RECOGNIZE_TIMEOUT,
    'production-orders:commitSourceImages': LONG_CALL_TIMEOUT
}

/**
 * 例外（用户 2026-10-20 批准）：router 内转发下游云函数有约 10s 硬超时，识别与原图提交
 * 必挂，这两条改为直调旧云函数。直调复用 utils/cloud-call.js，行为与旧页完全一致：
 * 附带 uniIdToken、客户端 100s/210s 超时、401 清态跳登录、错误文案归一、不自动重试。
 */
const DIRECT_ACTIONS = new Set([
    'doc-ocr:recognize',
    'production-orders:commitSourceImages'
])

function routeOf(name) {
    const route = ROUTES[name]
    if (!route) throw new Error('未登记的云函数：' + name)
    return route
}

function timeoutOf(name, action) {
    return TIMEOUTS[name + ':' + action] || CALL_TIMEOUT
}

/** 业务错误（带 code）原样抛；传输失败按旧 cloud-call 文案归一，便于页面/识别链路判断。 */
function normalizeFailure(name, action, error, elapsedMs) {
    const code = error && error.code
    const message = String((error && (error.message || error.errMsg || error.msg)) || '')
    if (code !== undefined && code !== null && code !== '') {
        // 与旧 callCloud 一致：401 清态跳登录后抛错
        if (code === 401) {
            logout()
            uni.reLaunch({ url: '/pages/login/login' })
            return new Error(message || '登录失效，请重新登录')
        }
        return error
    }
    const transport = !message || /request:fail|timeout|timed?\s*out|超时|SYSTEM_ERROR|network|网络|中断/i.test(message)
    const subject = name === 'doc-ocr' ? '云端识别' : '云端调用'
    const failure = new Error(transport
        ? subject + '中断（已等待约 ' + Math.max(1, Math.round(elapsedMs / 1000)) + ' 秒，可能超时或网络异常），本次未获得结果，' + (name === 'doc-ocr' ? '请重试或手动录入' : '请稍后重试')
        : '云端调用失败：' + message)
    failure.kind = transport ? 'timeout' : 'transport'
    failure.cause = message
    return failure
}

/**
 * 与旧 callCloud(name, action, payload, options) 同签名。
 * options.timeout 可覆盖；旧链路全部不自动重试（retry 仅显式传入时生效）。
 */
export async function callCloud(name, action, payload = {}, options = {}) {
    if (!getToken()) throw new Error('登录已失效，请重新登录')
    if (DIRECT_ACTIONS.has(name + ':' + action)) {
        return directCallCloud(name, action, payload, options)
    }
    const route = routeOf(name)
    const timeout = Number(options.timeout) || timeoutOf(name, action)
    const startedAt = Date.now()
    try {
        return await vkCall(route, Object.assign({ action }, payload), { retry: options.retry === true, timeout })
    } catch (error) {
        throw normalizeFailure(name, action, error, Date.now() - startedAt)
    }
}
