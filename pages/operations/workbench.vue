<template>
    <view class="fw-page op-page">
        <PageHead :subtitle="today + ' · ' + (profile.name || '生产助手')" refresh more @refresh="refresh" @more="openTools" />
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !dashboard" state="loading" />
        <template v-if="dashboard">
            <MetricStrip :items="metrics" @select="onMetric" />
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">今日任务</text><text class="fw-link" @tap="go('jobs', true)">全部 ›</text></view>
                <view class="row-list">
                    <ListRow v-for="job in taskJobs" :key="job._id" :title="job.productName" :code="job.batchNo" :meta="jobMeta(job)" :badge="states[job.state]" :badge-tone="stateTone(job.state)" @select="openJob(job)" />
                </view>
                <text v-if="!taskJobs.length" class="fw-note">当前范围没有工单，请由车间负责人派工。</text>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">今日排班</text><text class="fw-link" @tap="go('schedules')">全部 ›</text></view>
                <view class="row-list">
                    <ListRow v-for="row in shiftRows" :key="row._id" :title="name(catalogs.personnel, row.personId) + ' · ' + (row.post || '岗位待安排')" :meta="scheduleMeta(row)" @select="go('schedules')" />
                </view>
                <text v-if="!shiftRows.length" class="fw-note">今日没有排班记录。</text>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">快捷入口</text></view>
                <view class="quick-grid">
                    <view v-for="item in quickLinks" :key="item.key" class="quick-item" @tap="go(item.page, item.tab)">
                        <text class="quick-icon">{{ item.icon }}</text>
                        <text class="quick-label">{{ item.name }}</text>
                    </view>
                </view>
            </view>
        </template>
    </view>
</template>
<script>
import { callOperations, operationDate, operationsPage, loadOperations, operationName, JOB_STATES } from '@/utils/operations-api.js'
import PageHead from '@/components/ui/PageHead.vue'
import MetricStrip from '@/components/ui/MetricStrip.vue'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'

export default {
    components: { PageHead, MetricStrip, ListRow, StateView },
    mixins: [operationsPage],
    data() {
        return {
            today: operationDate(),
            dashboard: null,
            profile: {},
            catalogs: {},
            states: JOB_STATES,
            quickLinks: [
                { key: 'schedules', name: '排班', icon: '▦', page: 'schedules' },
                { key: 'handovers', name: '交接班', icon: '⇄', page: 'handovers' },
                { key: 'exceptions', name: '异常', icon: '!', page: 'exceptions', tab: false },
                { key: 'reports', name: '报表', icon: '≣', page: 'reports', tab: false }
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
    onShow() { this.today = operationDate(); this.load() },
    onPullDownRefresh() { this.refresh() },
    methods: {
        load() { return loadOperations(this, () => Promise.all([callOperations('bootstrap'), callOperations('dashboard', { date: this.today })]), ([base, dashboard]) => { this.profile = base.profile; this.catalogs = base.catalogs; this.dashboard = dashboard }) },
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
                    if (result.tapIndex === 2) uni.navigateTo({ url: '/pages/operations/trace' })
                }
            })
        },
        /** tab 页只能 switchTab（工单列表），普通页（排班/交接班等）用 navigateTo 保留返回。 */
        go(page, tab = false) { return uni[tab ? 'switchTab' : 'navigateTo']({ url: '/pages/operations/' + page }) },
        openJob(job) { uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(job._id) }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.row-list { display: flex; flex-direction: column; gap: var(--sp-8, 8rpx); }
.quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-12, 12rpx); }
.quick-item { display: flex; flex-direction: column; align-items: center; gap: var(--sp-4, 4rpx); padding: var(--sp-16, 16rpx) var(--sp-8, 8rpx); border-radius: var(--radius-button, 12rpx); background: $canvas; }
.quick-item:active { background: $primary-soft; }
.quick-icon { color: $primary; font-size: var(--fs-32, 32rpx); line-height: 1.1; }
.quick-label { color: $ink; font-size: var(--fs-24, 24rpx); line-height: 1.3; }
</style>
