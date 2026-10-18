<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">只显示你负责或有权限管理的工单。</text></view>
        <view class="fw-search"><input v-model="keyword" placeholder="批号、产品或工序" confirm-type="search" @confirm="search" /><text class="fw-link" @tap="search">查询</text></view>
        <view class="op-toolbar"><picker :range="filters" range-key="name" :value="filterIndex" :disabled="loading" @change="setFilter"><view class="fw-button secondary">{{ filters[filterIndex].name }} ▾</view></picker><button class="fw-button" :disabled="loading" @tap="search">{{ loading ? '加载中…' : '刷新' }}</button></view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <view class="fw-card"><view v-for="job in list" :key="job._id" class="op-row" @tap="open(job)"><view class="op-main"><text class="op-name">{{ job.productName }}</text><text class="op-code">{{ job.batchNo }}</text><text class="op-meta">{{ job.processName }} · {{ job.workshopName }}</text><text class="op-meta">合格 {{ job.goodQty || 0 }} / 目标 {{ job.targetQty }} {{ units[job.unit] }}</text></view><text class="fw-badge" :class="{ warning: job.state === 'paused' }">{{ states[job.state] }}</text></view><view v-if="!list.length && !loading" class="fw-empty"><text class="fw-empty-title">{{ error ? '工单加载失败' : '暂无工单' }}</text><text class="fw-note">排班与生产订单准备好后，由负责人在后台创建并派工。</text></view></view>
        <view class="op-toolbar"><button class="fw-button secondary" :disabled="loading || page <= 1" @tap="turn(-1)">上一页</button><text class="fw-note">{{ page }} · 共 {{ total }} 条</text><button class="fw-button secondary" :disabled="loading || page * pageSize >= total" @tap="turn(1)">下一页</button></view>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, JOB_STATES, OPERATION_UNITS } from '@/utils/operations-api.js'
export default {
    mixins: [operationsPage],
    data() { return { keyword: '', list: [], total: 0, page: 1, pageSize: 20, filterIndex: 0, states: JOB_STATES, units: OPERATION_UNITS, filters: [{ name: '全部状态', value: '' }, { name: '待开工', value: 'planned' }, { name: '生产中', value: 'running' }, { name: '已暂停', value: 'paused' }, { name: '已完工', value: 'completed' }] } },
    onShow() { this.load() },
    methods: {
        load() { return loadOperations(this, () => callOperations('listJobs', { page: this.page, pageSize: this.pageSize, keyword: this.keyword.trim(), state: this.filters[this.filterIndex].value }), result => { this.list = result.list; this.total = result.total }) },
        clearLoaded() { this.list = []; this.total = 0 },
        search() { if (this.loading) return; this.page = 1; this.load() },
        setFilter(event) { this.filterIndex = Number(event.detail.value); this.search() },
        turn(delta) { this.page += delta; this.load() },
        open(job) { uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(job._id) }) }
    }
}
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
