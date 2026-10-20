// P2 批 6-7：包材计算 / 计算历史 / 产品档案 / 识别设置页的 vk 数据层适配。
//
// 旧数据层（production-db / cloud-db / bom-db / product-materials-db）通过 callCloud(name, action, payload)
// 调业务云函数；新页统一改成 vk.callFunction → router facade（mes/pub/records|bom|buckets|materials|ocr）。
// 这几个 util 增加可选 call 参数后可直接注入本模块的 callCloud，旧页保持默认旧通道、零改动。
import { vkCall } from '@/utils/vk-operations.js'
import { getToken, logout } from '@/utils/auth.js'

const ROUTES = {
    'production-records': 'mes/pub/records',
    'product-bom': 'mes/pub/bom',
    'batch-buckets': 'mes/pub/buckets',
    'product-materials': 'mes/pub/materials',
    'production-orders': 'mes/pub/orders',
    'production-operations': 'mes/pub/operation',
    // P2 批 7：识别设置页走后台新增的 mes/pub/ocr-config（配置/个人 Key 白名单）；
    // 长耗时的 recognize 仍按批 5 例外由指令单页直调，不经过这里
    'doc-ocr': 'mes/pub/ocr-config'
}

/** 默认 60s；这批 action 都是亚秒级，无批 5 那种长耗时例外。 */
const CALL_TIMEOUT = 60000

function routeOf(name) {
    const route = ROUTES[name]
    if (!route) throw new Error('未登记的云函数：' + name)
    return route
}

/** 业务错误（带 code）原样抛；传输失败按旧 cloud-call 文案归一，便于页面判断。 */
function normalizeFailure(name, action, error, elapsedMs) {
    const code = error && error.code
    const message = String((error && (error.message || error.errMsg || error.msg)) || '')
    if (code !== undefined && code !== null && code !== '') {
        if (code === 401) {
            logout()
            uni.reLaunch({ url: '/pages/login/login' })
            return new Error(message || '登录失效，请重新登录')
        }
        return error
    }
    const transport = !message || /request:fail|timeout|timed?\s*out|超时|SYSTEM_ERROR|network|网络|中断/i.test(message)
    const failure = new Error(transport
        ? '云端调用中断（已等待约 ' + Math.max(1, Math.round(elapsedMs / 1000)) + ' 秒，可能超时或网络异常），本次未获得结果，请稍后重试'
        : '云端调用失败：' + message)
    failure.kind = transport ? 'timeout' : 'transport'
    failure.cause = message
    return failure
}

/**
 * 与旧 callCloud(name, action, payload, options) 同签名。
 * 写操作从不自动重试；只读 action 需要重试时显式传 options.retry。
 */
export async function callCloud(name, action, payload = {}, options = {}) {
    if (!getToken()) throw new Error('登录已失效，请重新登录')
    const route = routeOf(name)
    const timeout = Number(options.timeout) || CALL_TIMEOUT
    const startedAt = Date.now()
    try {
        return await vkCall(route, Object.assign({ action }, payload), { retry: options.retry === true, timeout })
    } catch (error) {
        throw normalizeFailure(name, action, error, Date.now() - startedAt)
    }
}
