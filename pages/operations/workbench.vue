<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">{{ today }} · {{ profile.name || '生产助手' }}</text></view>
        <view class="op-toolbar"><button class="fw-button secondary" :disabled="loading" @tap="load">{{ loading ? '刷新中…' : '刷新现场数据' }}</button></view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <view v-if="dashboard" class="op-grid">
            <view class="fw-card"><text class="op-number">{{ dashboard.counts.running }}</text><text class="op-meta">生产中工单</text></view>
            <view class="fw-card"><text class="op-number">{{ dashboard.counts.completed }}</text><text class="op-meta">已完工工单</text></view>
            <view class="fw-card" @tap="go('handovers', true)"><text class="op-number">{{ dashboard.counts.pendingHandovers }}</text><text class="op-meta">待接班</text></view>
            <view class="fw-card" @tap="go('exceptions')"><text class="op-number">{{ dashboard.counts.openExceptions }}</text><text class="op-meta">待处理异常</text></view>
        </view>
        <view class="fw-card"><view class="fw-heading"><text class="fw-heading-title">生产工具</text></view><view class="op-grid"><button class="fw-button primary" @tap="goCalculation">包材计算</button><button class="fw-button" @tap="go('tools')">标准差计算</button><button class="fw-button" @tap="go('reports')">班次产量报表</button><button class="fw-button" @tap="go('trace')">批次追溯</button></view><text class="fw-note">计算结果可继续保存到原有生产记录。</text></view>
        <view v-if="dashboard" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">当前工单</text><text class="fw-link" @tap="go('jobs', true)">全部 ›</text></view><view v-for="job in dashboard.jobs" :key="job._id" class="op-row" @tap="openJob(job)"><view class="op-main"><text class="op-name">{{ job.productName }}</text><text class="op-meta">{{ job.batchNo }} · {{ job.processName }}</text></view><text class="fw-badge">{{ states[job.state] }}</text></view><text v-if="!dashboard.jobs.length" class="op-meta">当前范围没有工单，请由车间负责人派工。</text></view>
        <view v-if="dashboard" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">今日排班</text><text class="fw-link" @tap="go('schedules', true)">全部 ›</text></view><view v-for="row in dashboard.schedules" :key="row._id" class="op-row"><view><text class="op-name">{{ name(catalogs.personnel, row.personId) }} · {{ row.post || '岗位待安排' }}</text><text class="op-meta">{{ name(catalogs.shifts, row.shiftId) }} · {{ name(catalogs.processes, row.processId) }} · {{ row.startTime }}–{{ row.endTime }}</text></view></view><text v-if="!dashboard.schedules.length" class="op-meta">今日没有排班记录。</text></view>
    </view>
</template>
<script>
import { callOperations, operationDate, operationsPage, loadOperations, operationName, JOB_STATES } from '@/utils/operations-api.js'
export default {
    mixins: [operationsPage],
    data() { return { today: operationDate(), dashboard: null, profile: {}, catalogs: {}, states: JOB_STATES } },
    onShow() { this.today = operationDate(); this.load() },
    methods: {
        load() { return loadOperations(this, () => Promise.all([callOperations('bootstrap'), callOperations('dashboard', { date: this.today })]), ([base, dashboard]) => { this.profile = base.profile; this.catalogs = base.catalogs; this.dashboard = dashboard }) },
        clearLoaded() { this.dashboard = null; this.profile = {}; this.catalogs = {} },
        name: operationName,
        go(page, tab = false) { uni[tab ? 'switchTab' : 'navigateTo']({ url: '/pages/operations/' + page }) },
        goCalculation() { uni.navigateTo({ url: '/pages/materials/materials' }) },
        openJob(job) { uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(job._id) }) }
    }
}
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
