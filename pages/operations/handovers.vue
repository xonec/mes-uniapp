<template>
    <view class="fw-page op-page"><view class="fw-header"><text class="fw-subtitle">交班内容提交后冻结，由指定接班人确认。</text></view><view class="op-toolbar"><button class="fw-button primary" @tap="open()">填写交班单</button><button class="fw-button secondary" :disabled="loading" @tap="refresh">刷新</button></view><view v-if="error" class="fw-notice error">{{ error }}</view>
        <view v-for="row in list" :key="row._id" class="fw-card" @tap="open(row)"><view class="fw-heading"><text class="fw-heading-title">{{ row.date }} · {{ name(catalogs.processes, row.processId) }}</text><text class="fw-badge" :class="{ warning: row.status === 'submitted' }">{{ states[row.status] }}</text></view><text class="op-meta">{{ name(catalogs.shifts, row.shiftId) }} → {{ name(catalogs.shifts, row.nextShiftId) }}</text><text class="op-meta">交班：{{ row.authorName || '—' }} / 接班：{{ row.receiverName || name(catalogs.personnel, row.receiverId) }}</text><text class="op-meta">{{ row.content }}</text></view>
        <view v-if="!list.length && !loading" class="fw-card fw-empty"><text class="fw-empty-title">暂无交接记录</text><text class="fw-note">先保存草稿，核对后提交。</text></view><view class="op-toolbar"><button class="fw-button secondary" :disabled="loading || page <= 1" @tap="turn(-1)">上一页</button><text class="fw-note">共 {{ total }} 条</text><button class="fw-button secondary" :disabled="loading || page * 20 >= total" @tap="turn(1)">下一页</button></view>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationName, HANDOVER_STATES } from '@/utils/operations-api.js'
export default { mixins: [operationsPage], data() { return { list: [], catalogs: {}, page: 1, total: 0, states: HANDOVER_STATES } }, onShow() { this.load() }, methods: {
    load() { return loadOperations(this, () => Promise.all([callOperations('bootstrap'), callOperations('listHandovers', { page: this.page, pageSize: 20 })]), ([base, result]) => { this.catalogs = base.catalogs; this.list = result.list; this.total = result.total }) },
    clearLoaded() { this.list = []; this.total = 0 }, name: operationName, refresh() { this.page = 1; this.load() }, turn(delta) { this.page += delta; this.load() },
    open(row) { if (row) uni.setStorageSync('mes:handover-view', row); uni.navigateTo({ url: '/pages/operations/handover-detail' + (row ? '?id=' + encodeURIComponent(row._id) : '') }) }
} }
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
