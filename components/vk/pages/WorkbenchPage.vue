<template>
    <view class="fw-page op-page">
        <PageHead :subtitle="today + ' · ' + (profile.name || '生产助手')" refresh more @refresh="refresh" @more="openTools" />
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !dashboard" state="loading" />
        <template v-if="dashboard">
            <MetricStrip :items="metrics" @select="onMetric" />
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">今日任务</text><text class="fw-link" @tap="go('jobs')">全部 ›</text></view>
                <view class="row-list">
                    <ListRow class="row-list-item" v-for="job in taskJobs" :key="job._id" :title="job.productName" :code="job.batchNo" :meta="jobMeta(job)" :badge="states[job.state]" :badge-tone="stateTone(job.state)" @select="openJob(job)" />
                </view>
                <text v-if="!taskJobs.length" class="fw-note">当前范围没有工单，请由车间负责人派工。</text>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">今日排班</text><text class="fw-link" @tap="go('schedules')">全部 ›</text></view>
                <view class="row-list">
                    <ListRow class="row-list-item" v-for="row in shiftRows" :key="row._id" :title="name(catalogs.personnel, row.personId) + ' · ' + (row.post || '岗位待安排')" :meta="scheduleMeta(row)" @select="go('schedules')" />
                </view>
                <text v-if="!shiftRows.length" class="fw-note">今日没有排班记录。</text>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">快捷入口</text></view>
                <view class="quick-grid">
                    <view v-for="item in quickLinks" :key="item.key" class="quick-item" @tap="go(item.page, item.tab)">
                        <view class="quick-icon"><uni-icons :type="item.icon" size="16" color="#008577"></uni-icons></view>
                        <text class="quick-label">{{ item.name }}</text>
                    </view>
                </view>
            </view>
        </template>
    </view>
</template>
<script>
import { operationDate, operationsPage, loadOperations, operationName, JOB_STATES } from '@/utils/operations-api.js'
import { vkOperations, loadVkBootstrap } from '@/utils/vk-operations.js'
import { openPage } from '@/utils/vk-migration.js'
import PageHead from '@/components/ui/PageHead.vue'
import MetricStrip from '@/components/ui/MetricStrip.vue'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'

export default {
    components: { PageHead, MetricStrip, ListRow, StateView },
    mixins: [operationsPage],
    /** tab 壳页用 tick 驱动组件生命周期，避免跨组件 $refs 调方法（uni-app H5 下 ref 行为不一致）。 */
    props: {
        showTick: { type: Number, default: 0 },
        refreshTick: { type: Number, default: 0 }
    },
    data() {
        return {
            today: operationDate(),
            dashboard: null,
            profile: {},
            catalogs: {},
            states: JOB_STATES,
            quickLinks: [
                { key: 'schedules', name: '排班', icon: 'calendar', page: 'schedules' },
                { key: 'handovers', name: '交接班', icon: 'loop', page: 'handovers' },
                { key: 'exceptions', name: '异常', icon: 'info', page: 'exceptions', tab: false },
                { key: 'reports', name: '报表', icon: 'bars', page: 'reports', tab: false }
            ]
        }
    },
    computed: {
        metrics() {
            const counts = (this.dashboard && this.dashboard.counts) || {}
            return [
                { value: counts.running || 0, label: '生产中', tone: 'neutral' },
                { value: counts.completed || 0, label: '已完工', tone: 'neutral' },
                { value: counts.pendingHandovers || 0, label: '待接班', tone: 'primary', clickable: true, target: 'handovers' },
                { value: counts.openExceptions || 0, label: '待处理异常', tone: 'warning', clickable: true, target: 'exceptions' }
            ]
        },
        taskJobs() { return ((this.dashboard && this.dashboard.jobs) || []).slice(0, 3) },
        shiftRows() { return ((this.dashboard && this.dashboard.schedules) || []).slice(0, 2) }
    },
    mounted() { this.handlePageShow() },
    watch: {
        showTick() { this.handlePageShow() },
        refreshTick() { this.handlePullDown() }
    },
    methods: {
        /** 由 tab 壳页的 tick/watch 与 mounted 驱动；方法名避开 uni-app 页面生命周期钩子（编译器会提升同名方法）。 */
        handlePageShow() { this.today = operationDate(); this.load() },
        handlePullDown() { this.refresh() },
        /** 串行取数：先复用共享 bootstrap，再发主请求，避免同时触发多个冷启动。 */
        load() { return loadOperations(this, async () => { const base = await loadVkBootstrap(); const dashboard = await vkOperations('dashboard', { date: this.today }); return [base, dashboard] }, ([base, dashboard]) => { this.profile = base.profile; this.catalogs = base.catalogs; this.dashboard = dashboard }) },
        refresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
        clearLoaded() { this.dashboard = null; this.profile = {}; this.catalogs = {} },
        name: operationName,
        jobMeta(job) { return [job.processName, job.workshopName].filter(Boolean).join(' · ') },
        scheduleMeta(row) { return [this.name(this.catalogs.shifts, row.shiftId), this.name(this.catalogs.processes, row.processId), row.startTime && row.endTime ? row.startTime + '–' + row.endTime : ''].filter(Boolean).join(' · ') },
        stateTone(state) { return state === 'running' ? 'primary' : state === 'paused' ? 'warning' : 'neutral' },
        onMetric(item) { if (item.target) this.go(item.target) },
        openTools() {
            uni.showActionSheet({
                itemList: ['包材计算', '标准差计算', '批次追溯'],
                success: result => {
                    if (result.tapIndex === 0) uni.navigateTo({ url: '/pages/materials/materials' })
                    if (result.tapIndex === 1) uni.navigateTo({ url: '/pages/operations/tools' })
                    if (result.tapIndex === 2) openPage('operations.trace')
                }
            })
        },
        /** 入口统一走 vk-migration：tab 页 switchTab，普通页 navigateTo，迁移后按开关切新页。 */
        go(page) { return openPage('operations.' + page) },
        openJob(job) { openPage('operations.job-detail', { id: job._id }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.quick-grid { display: flex; margin-right: -12rpx; }
.quick-item { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; margin-right: 12rpx; padding: var(--sp-16, 16rpx) var(--sp-8, 8rpx); border-radius: var(--radius-button, 12rpx); background: $canvas; }
.quick-item:active { background: $primary-soft; }
.quick-icon { display: flex; align-items: center; justify-content: center; height: 36rpx; }
.quick-label { margin-top: 4rpx; color: $ink; font-size: var(--fs-24, 24rpx); line-height: 1.3; }

.row-list { display: flex; flex-direction: column; }
.row-list-item + .row-list-item { margin-top: var(--sp-8, 8rpx); }

</style>
