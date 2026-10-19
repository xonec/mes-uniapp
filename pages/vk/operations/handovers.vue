<template>
    <view class="fw-page op-page has-action-bar">
        <PageHead subtitle="交班内容提交后冻结，由指定接班人确认。" refresh @refresh="refresh" />
        <FilterBar :items="filters" :value="status" @change="changeStatus" />
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !list.length" state="loading" />
        <view v-else-if="!list.length">
            <StateView v-if="!error" state="empty" title="当前筛选没有交接记录" reason="先填写交班单，提交后由接班人确认" />
        </view>
        <view v-else class="row-list">
            <ListRow class="row-item" v-for="row in list" :key="row._id" :title="titleOf(row)" :meta="metaOf(row)" :preview="row.content" :badge="states[row.status]" :badge-tone="toneOf(row.status)" @select="open(row)" />
            <StateView v-if="loadingMore" state="more" />
            <text v-else-if="list.length >= total && total" class="fw-note list-end">已全部加载 · 共 {{ total }} 条</text>
        </view>
        <ActionBar primary="填写交班单" @primary="open()" />
    </view>
</template>
<script>
import { operationsPage, loadOperations, HANDOVER_STATES } from '@/utils/operations-api.js'
import { vkOperations } from '@/utils/vk-operations.js'
import { openPage } from '@/utils/vk-migration.js'
import PageHead from '@/components/ui/PageHead.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'
import ActionBar from '@/components/ui/ActionBar.vue'

export default {
    components: { PageHead, FilterBar, ListRow, StateView, ActionBar },
    mixins: [operationsPage],
    data() {
        return {
            list: [],
            total: 0,
            page: 1,
            pageSize: 20,
            loadingMore: false,
            status: '',
            states: HANDOVER_STATES,
            /** 服务端 listHandovers 只支持 status 过滤；「我的交班」没有对应参数，先不做。 */
            filters: [{ name: '全部', value: '' }, { name: '待接班', value: 'submitted' }]
        }
    },
    onShow() { this.load() },
    onPullDownRefresh() { this.refresh() },
    onReachBottom() { this.loadMore() },
    methods: {
        load() { return loadOperations(this, () => this.fetch(1), result => { this.list = result.list || []; this.total = result.total || 0; this.page = 1 }) },
        fetch(page) { return vkOperations('listHandovers', { page, pageSize: this.pageSize, status: this.status }) },
        refresh() { this.load().finally(() => uni.stopPullDownRefresh()) },
        clearLoaded() { this.list = []; this.total = 0 },
        async loadMore() {
            if (this.loading || this.loadingMore || !this.list.length || this.list.length >= this.total) return
            const epoch = this.loadEpoch
            this.loadingMore = true
            try {
                const result = await this.fetch(this.page + 1)
                if (this.loadEpoch !== epoch) return
                const seen = new Set(this.list.map(row => row._id))
                this.list = this.list.concat((result.list || []).filter(row => !seen.has(row._id)))
                this.total = result.total || 0
                this.page += 1
            } catch (error) {
                if (this.loadEpoch === epoch) this.error = error.message || '加载失败，请重试'
            } finally {
                if (this.loadEpoch === epoch) this.loadingMore = false
            }
        },
        changeStatus(value) { if (this.loading) return; this.status = value; this.load() },
        titleOf(row) { return [row.date, row.shiftName || '未填写班次', row.processName || ''].filter(Boolean).join(' · ') },
        metaOf(row) { return '交班 ' + (row.authorName || '—') + ' → 接班 ' + (row.receiverName || '—') },
        toneOf(status) { return status === 'submitted' ? 'warning' : 'neutral' },
        open(row) {
            if (row) uni.setStorageSync('mes:handover-view', row)
            openPage('operations.handover-detail', row ? { id: row._id } : {})
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.row-list { display: flex; flex-direction: column;  }
.list-end { display: block; text-align: center; padding: var(--sp-16, 16rpx) 0 var(--sp-8, 8rpx); }

.row-list { display: flex; flex-direction: column; }
.row-item + .row-item { margin-top: var(--sp-8, 8rpx); }

</style>
