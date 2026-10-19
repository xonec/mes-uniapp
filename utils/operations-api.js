import { callCloud } from '@/utils/cloud-call.js'
import { getUser, getToken } from '@/utils/auth.js'

/** 只读 action：冷启动超时/网络失败自动重试一次；写 action 保持单次，避免重复提交。 */
const RETRY_ACTIONS = new Set([
    'bootstrap', 'dashboard', 'scheduleCalendar', 'myScheduleDay',
    'myAttendance', 'attendanceSummary', 'attendanceHistory', 'listAttendance',
    'listJobs', 'getJob', 'listHandovers', 'getHandover', 'listExceptions',
    'listSchedules', 'scheduleImportScope', 'report', 'trace', 'audit'
])

/** 调用同一空间内生产执行服务，由服务端决定人员数据范围。 */
export function callOperations(action, payload = {}, options = {}) {
    const retry = typeof options.retry === 'boolean' ? options.retry : RETRY_ACTIONS.has(action)
    return callCloud('production-operations', action, payload, { retry })
}

/**
 * bootstrap 共享缓存（按 token 隔离，TTL 2 分钟）：
 * 工作台/排班/考勤等页面先复用同一份基础数据，只有一个页面真正发请求，其余等它的结果，
 * 避免多个页面/多个请求同时触发云函数冷启动。
 */
const BOOTSTRAP_TTL = 120000
let bootstrapCache = { token: '', at: 0, data: null, pending: null }

export function loadBootstrap() {
    const token = getToken() || ''
    const fresh = bootstrapCache.data && bootstrapCache.token === token && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL
    if (fresh) return Promise.resolve(bootstrapCache.data)
    if (bootstrapCache.pending) return bootstrapCache.pending
    const pending = callOperations('bootstrap').then(data => {
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
export function clearBootstrapCache() {
    bootstrapCache = { token: '', at: 0, data: null, pending: null }
}
/** 使用本地日期，避免夜班跨 UTC 日期造成排班错日。 */
export function operationDate(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') }
/** 为重试保留同一请求编号；修改内容后产生新编号。 */
export function operationRequest(vm, command, payload) {
    const signature = JSON.stringify({ command, payload })
    if (!vm.pendingRequest || vm.pendingRequest.signature !== signature) vm.pendingRequest = { signature, id: 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) }
    return vm.pendingRequest.id
}
/** 重新进入页面时统一清理陈旧错误，加载失败不会留下旧业务列表。 */
export async function loadOperations(vm, fetcher, apply) {
    if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }
    const epoch = ++vm.loadEpoch
    vm.loading = true; vm.error = ''
    try { const result = await fetcher(); if (vm.loadEpoch === epoch) apply(result) }
    catch (error) { if (vm.loadEpoch === epoch) { vm.error = error.message || '加载失败，请重试'; if (vm.clearLoaded) vm.clearLoaded() } }
    finally { if (vm.loadEpoch === epoch) vm.loading = false }
}
/** 进入计算前带上工单采用的订单版本，防止计算自动改用新版本。 */
export function openJobCalculation(job) {
    uni.setStorageSync('mes:operation-calculation', { batchNo: job.batchNo, jobId: job._id, orderNo: job.orderNo, orderVersion: job.orderVersion, orderSnapshot: job.orderSnapshot })
    uni.navigateTo({ url: '/pages/materials/materials' })
}
/** 使用目录名称显示引用，历史名称优先由服务端冻结快照提供。 */
export function operationName(items, id) { const item = (items || []).find(value => value._id === id); return item ? item.name : id || '—' }
export const JOB_STATES = { planned: '待开工', running: '生产中', paused: '已暂停', completed: '已完工' }
export const HANDOVER_STATES = { draft: '草稿', submitted: '待接班', received: '已接班' }
export const OPERATION_UNITS = { bottle: '瓶', case: '件', piece: '个' }
export const EVENT_NAMES = { create: '建立工单', start: '开工', pause: '暂停', resume: '继续生产', report: '班次报工', inbound: '入库确认', complete: '完工', submit: '交班', receive: '接班' }
export const operationsPage = {
    data() { return { loading: false, saving: false, error: '', loadEpoch: 0, pendingRequest: null } },
    onHide() { this.loadEpoch++; this.loading = false },
    onUnload() { this.loadEpoch++ }
}
