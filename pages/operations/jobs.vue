<template>
    <view class="fw-page op-page">
        <FilterBar :items="filters" :value="stateValue" search @change="changeFilter" @search="toggleSearch" />
        <view v-if="searchOpen" class="fw-search">
            <input v-model="keyword" :focus="searchOpen" placeholder="批号、产品或工序" confirm-type="search" @confirm="search" />
            <text class="fw-search-clear" @tap="search">查询</text>
        </view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !list.length" state="loading" />
        <view v-else-if="!list.length">
            <StateView v-if="!error" state="empty" title="当前筛选没有工单" reason="换个状态看看，或清除筛选重新加载" />
        </view>
        <view v-else class="job-list">
            <ListRow class="job-item" v-for="job in list" :key="job._id" :title="job.productName" :code="job.batchNo" :meta="jobMeta(job)" :badge="states[job.state]" :badge-tone="stateTone(job.state)" :progress="progressOf(job)" :progress-text="progressText(job)" :progress-tone="stateTone(job.state)" @select="open(job)" />
            <StateView v-if="loadingMore" state="more" />
            <text v-else-if="list.length >= total && list.length > pageSize" class="fw-note jobs-end">已全部加载 · 共 {{ total }} 条</text>
        </view>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, JOB_STATES, OPERATION_UNITS } from '@/utils/operations-api.js'
import FilterBar from '@/components/ui/FilterBar.vue'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'

export default {
    components: { FilterBar, ListRow, StateView },
    mixins: [operationsPage],
    data() {
        return {
            keyword: '',
            searchOpen: false,
            list: [],
            total: 0,
            page: 1,
            pageSize: 20,
            loadingMore: false,
            stateValue: '',
            states: JOB_STATES,
            units: OPERATION_UNITS,
            filters: [
                { name: '全部', value: '' },
                { name: '进行中', value: 'running' },
                { name: '暂停', value: 'paused' },
                { name: '已完工', value: 'completed' }
            ]
        }
    },
    onShow() { this.load() },
    onPullDownRefresh() { this.refresh() },
    onReachBottom() { this.loadMore() },
    methods: {
        load() { return loadOperations(this, () => this.fetch(1), result => { this.list = result.list || []; this.total = result.total || 0; this.page = 1 }) },
        fetch(page) { return callOperations('listJobs', { page, pageSize: this.pageSize, keyword: this.keyword.trim(), state: this.stateValue }) },
        refresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
        clearLoaded() { this.list = []; this.total = 0 },
        async loadMore() {
            if (this.loading || this.loadingMore || !this.list.length || this.list.length >= this.total) return
            const epoch = this.loadEpoch
            this.loadingMore = true
            try {
                const result = await this.fetch(this.page + 1)
                if (this.loadEpoch !== epoch) return
                this.list = this.list.concat(result.list || [])
                this.total = result.total || 0
                this.page += 1
            } catch (error) {
                if (this.loadEpoch === epoch) this.error = error.message || '加载失败，请重试'
            } finally {
                if (this.loadEpoch === epoch) this.loadingMore = false
            }
        },
        changeFilter(value) { if (this.loading) return; this.stateValue = value; this.load() },
        toggleSearch() { this.searchOpen = !this.searchOpen },
        search() { if (this.loading) return; this.load() },
        jobMeta(job) { return [job.processName, job.workshopName].filter(Boolean).join(' · ') },
        stateTone(state) { return state === 'running' ? 'primary' : state === 'paused' ? 'warning' : 'neutral' },
        progressOf(job) { const target = Number(job.targetQty) || 0; if (!target) return null; return Math.min(100, Math.round((Number(job.goodQty) || 0) / target * 100)) },
        progressText(job) { return '合格 ' + (job.goodQty || 0) + ' / ' + (job.targetQty || 0) + ' ' + (this.units[job.unit] || '') },
        open(job) { uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(job._id) }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.job-list { display: flex; flex-direction: column;  }
.jobs-end { display: block; text-align: center; padding: var(--sp-16, 16rpx) 0 var(--sp-8, 8rpx); }

.job-list { display: flex; flex-direction: column; }
.job-item + .job-item { margin-top: var(--sp-8, 8rpx); }

</style>
