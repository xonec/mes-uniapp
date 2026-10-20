// P2 数据层：现场端统一走 vk.callFunction → router 适配层（mes/pub/*）→ 现有业务云函数。
//
// 注意：router 返回 { code, message, data }，业务结果在 data 里；直调 production-operations
// 是扁平结构。页面只拿这里 unwrap 后的业务数据，不要直接读 res.list。
// 只读 action 在系统/网络超时后重试一次（与旧 cloud-call 策略一致），写操作从不重试。
import vk from 'uni_modules/vk-unicloud'
import { getToken } from '@/utils/auth.js'

/** router 只读 action 白名单（与 router/util/mes-forward.js 的 READ_ACTIONS 对齐）。 */
export const READ_ACTIONS = new Set([
    'bootstrap', 'dashboard', 'scheduleCalendar', 'listSchedules', 'myScheduleDay',
    'myAttendance', 'attendanceSummary', 'attendanceHistory', 'listAttendance',
    'listJobs', 'getJob', 'listHandovers', 'getHandover', 'listExceptions',
    'report', 'trace', 'audit'
])

const RETRY_DELAY = 1200
const OPERATIONS_URL = 'mes/pub/operation'

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

/** 统一解包：code 0 取 data；其余抛出带 message 的错误。 */
export function unwrap(result) {
    if (!result || typeof result !== 'object') throw new Error('云端返回结构异常')
    if (result.code !== 0) throw new Error(result.message || result.msg || '调用失败')
    if (result.data !== undefined) return result.data
    return result
}

function request(url, data, timeout) {
    return new Promise((resolve, reject) => {
        try {
            vk.callFunction({
                url,
                data,
                // 错误由页面统一展示，避免 vk 默认弹窗与页面提示重复
                timeout,
                fail: res => reject(res)
            }).then(resolve, reject)
        } catch (error) {
            reject(error)
        }
    })
}

function messageOf(error) {
    if (!error) return '云端调用失败'
    if (typeof error === 'string') return error
    return error.message || error.msg || error.errMsg || '云端调用失败'
}

function failure(error) {
    const result = new Error(messageOf(error))
    if (error && typeof error === 'object') {
        result.code = error.code
        result.raw = error
    }
    return result
}

function retryable(error) {
    const code = error && error.code
    if (code === 'SYS_ERR' || code === 90001 || code === 'InternalServerError') return true
    return /timeout|超时|request:fail|网络|连接超时/i.test(messageOf(error))
}

/**
 * 调 vk 路由。
 * @param {String} url 路由地址（如 mes/pub/operation）
 * @param {Object} data 请求参数；data.action 决定是否允许重试
 * @param {Object} options { retry: Boolean } 默认只读 action 重试一次
 */
export async function vkCall(url, data = {}, options = {}) {
    if (!getToken()) throw new Error('登录已失效，请重新登录')
    const retry = typeof options.retry === 'boolean' ? options.retry : READ_ACTIONS.has(data.action)
    const timeout = options.timeout
    let first
    try {
        return unwrap(await request(url, data, timeout))
    } catch (error) {
        first = error
    }
    if (!retry || !retryable(first)) throw failure(first)
    await sleep(RETRY_DELAY)
    try {
        return unwrap(await request(url, data, timeout))
    } catch (error) {
        throw failure(error)
    }
}

/** 生产执行服务（production-operations）的只读转发。 */
export function vkOperations(action, payload = {}, options = {}) {
    return vkCall(OPERATIONS_URL, Object.assign({ action }, payload), options)
}

/**
 * bootstrap 共享缓存：按 token 隔离，TTL 2 分钟。
 * 工作台/考勤/排班等 tab 页复用同一份基础数据，避免各自触发冷启动。
 */
const BOOTSTRAP_TTL = 120000
let bootstrapCache = { token: '', at: 0, data: null, pending: null }

export function loadVkBootstrap() {
    const token = getToken() || ''
    const fresh = bootstrapCache.data && bootstrapCache.token === token && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL
    if (fresh) return Promise.resolve(bootstrapCache.data)
    if (bootstrapCache.pending) return bootstrapCache.pending
    const pending = vkOperations('bootstrap').then(data => {
        bootstrapCache = { token, at: Date.now(), data, pending: null }
        return data
    }, error => {
        bootstrapCache = { token: '', at: 0, data: null, pending: null }
        throw error
    })
    bootstrapCache.pending = pending
    return pending
}

/** 退出登录/切换账号后清空基础数据缓存。 */
export function clearVkBootstrapCache() {
    bootstrapCache = { token: '', at: 0, data: null, pending: null }
}
