import { callCloud } from '@/utils/cloud-call.js'
import { getUser } from '@/utils/auth.js'

/** 调用同一空间内生产执行服务，由服务端决定人员数据范围。 */
export function callOperations(action, payload = {}) { return callCloud('production-operations', action, payload) }
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
