<template>
    <view class="fw-page op-page has-action-bar">
        <view class="exc-head">
            <view class="exc-pending"><text class="exc-pending-num">{{ openCount }}</text><text class="exc-pending-label">待处理异常</text></view>
            <view class="exc-refresh" aria-label="刷新" @tap="refresh"><uni-icons type="refresh" size="16" color="#008577"></uni-icons></view>
        </view>
        <view v-if="error && !drawerOpen" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !list.length" state="loading" />
        <view v-else-if="!list.length">
            <StateView v-if="!error" state="empty" title="当前没有异常记录" reason="生产中发现异常时，从这里登记并跟踪处理" />
        </view>
        <view v-else class="row-list">
            <ListRow class="row-item" v-for="row in orderedList" :key="row._id" :tag="categoryName(row.category)" :title="row.batchNo || row.jobId" :meta="metaOf(row)" :preview="row.description" :badge="row.status === 'resolved' ? '已处理' : '待处理'" :badge-tone="row.status === 'resolved' ? 'neutral' : 'warning'" @select="openJob(row.jobId)" />
            <StateView v-if="loadingMore" state="more" />
            <text v-else-if="list.length >= total && total" class="fw-note list-end">已全部加载 · 共 {{ total }} 条</text>
        </view>
        <ActionBar primary="登记异常" @primary="openDrawer()" />

        <view v-if="drawerOpen" class="exc-mask" @tap="closeDrawer">
            <view class="exc-sheet" @tap.stop>
                <view class="exc-sheet-head">
                    <text class="exc-sheet-title">登记异常</text>
                    <text class="exc-sheet-close" @tap="closeDrawer">×</text>
                </view>
                <text v-if="error" class="exc-error">{{ error }}</text>
                <view v-if="presetJobId" class="fw-field"><text class="fw-label">关联工单</text><view class="fw-input">{{ presetBatchNo || presetJobId }}</view></view>
                <template v-else>
                    <view class="fw-field">
                        <text class="fw-label">关联工单 *</text>
                        <view class="exc-search"><input v-model="jobKeyword" placeholder="输入完整批号搜索" confirm-type="search" :disabled="saving" @confirm="searchJobs" /><text class="exc-search-btn" @tap="searchJobs">{{ finding ? '查询中…' : '查询' }}</text></view>
                    </view>
                    <view v-if="form.jobId" class="fw-field"><text class="fw-label">已选工单</text><view class="fw-input">{{ selectedBatchNo }}</view></view>
                    <view v-else-if="jobChoices.length" class="exc-choices">
                        <view v-for="job in jobChoices" :key="job._id" class="exc-choice" @tap="pickJob(job)">
                            <text class="exc-choice-title">{{ job.batchNo }}</text>
                            <text class="exc-choice-meta">{{ job.productName }} · {{ job.processName }}</text>
                        </view>
                    </view>
                    <text v-else-if="searched" class="fw-note">没有匹配的工单，请核对完整批号。</text>
                </template>
                <view class="fw-field"><text class="fw-label">异常类别 *</text><view class="op-chips exc-chips"><text v-for="item in categories" :key="item._id" class="op-chip" :class="{ selected: form.category === item._id }" @tap="form.category = item._id">{{ item.name }}</text></view></view>
                <view class="fw-field"><text class="fw-label">异常内容及现场处理 *</text><textarea v-model="form.description" class="fw-textarea" maxlength="4000" :disabled="saving" placeholder="说明异常、现场措施和需要协助的事项" /></view>
                <button class="fw-button primary exc-submit" :disabled="saving" @tap="save">{{ saving ? '提交中…' : '提交异常' }}</button>
            </view>
        </view>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationRequest } from '@/utils/operations-api.js'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'
import ActionBar from '@/components/ui/ActionBar.vue'

const CATEGORIES = [
    { _id: 'quality', name: '质量' },
    { _id: 'equipment', name: '设备' },
    { _id: 'material', name: '物料' },
    { _id: 'safety', name: '安全' },
    { _id: 'other', name: '其他' }
]

export default {
    components: { ListRow, StateView, ActionBar },
    mixins: [operationsPage],
    data() {
        return {
            jobId: '',
            presetJobId: '',
            presetBatchNo: '',
            presetLoaded: false,
            openedForJob: false,
            drawerOpen: false,
            list: [],
            total: 0,
            openCount: 0,
            page: 1,
            pageSize: 20,
            loadingMore: false,
            form: { jobId: '', category: '', description: '' },
            jobKeyword: '',
            jobChoices: [],
            finding: false,
            searched: false,
            categories: CATEGORIES
        }
    },
    computed: {
        /** 待处理置顶，其余保持服务端 updatedAt 倒序。 */
        orderedList() { return this.list.slice().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1)) },
        selectedBatchNo() { const job = this.jobChoices.find(row => row._id === this.form.jobId); return (job && job.batchNo) || this.presetBatchNo || '' }
    },
    onLoad(options) { this.jobId = options.jobId || '' },
    onShow() { this.load().then(() => this.maybeOpenForJob()) },
    onReachBottom() { this.loadMore() },
    methods: {
        load() {
            return loadOperations(this, async () => {
                const result = await callOperations('listExceptions', { page: 1, pageSize: this.pageSize })
                const open = await callOperations('listExceptions', { status: 'open', page: 1, pageSize: 1 })
                return [result, open]
            }, ([result, open]) => {
                this.list = result.list || []
                this.total = result.total || 0
                this.openCount = (open && open.total) || 0
                this.page = 1
            })
        },
        fetch(page) { return callOperations('listExceptions', { page, pageSize: this.pageSize }) },
        clearLoaded() { this.list = []; this.total = 0; this.openCount = 0 },
        refresh() { if (!this.loading) this.load() },
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
        maybeOpenForJob() {
            if (!this.jobId || this.openedForJob) return
            this.openedForJob = true
            this.loadPresetJob().then(() => this.openDrawer())
        },
        async loadPresetJob() {
            try {
                const job = await callOperations('getJob', { id: this.jobId })
                this.presetJobId = this.jobId
                this.presetBatchNo = (job && job.batchNo) || ''
            } catch (error) {
                this.presetJobId = this.jobId
            }
        },
        openDrawer() {
            this.error = ''
            if (this.presetJobId) this.form.jobId = this.presetJobId
            this.drawerOpen = true
        },
        closeDrawer() { if (!this.saving) this.drawerOpen = false },
        async searchJobs() {
            const keyword = this.jobKeyword.trim().toUpperCase()
            if (!keyword) { this.error = '请输入完整批号'; return }
            this.finding = true; this.error = ''; this.searched = false
            try {
                const result = await callOperations('listJobs', { keyword, page: 1, pageSize: 20 })
                this.jobChoices = (result.list || []).filter(job => job.batchNo === keyword)
                this.searched = true
            } catch (error) {
                this.error = error.message
            } finally {
                this.finding = false
            }
        },
        pickJob(job) { this.form.jobId = job._id; this.presetBatchNo = job.batchNo; this.jobChoices = []; this.error = '' },
        categoryName(value) { const row = this.categories.find(item => item._id === value); return row ? row.name : value },
        metaOf(row) { return [row.processName, row.createdName || row.actorName].filter(Boolean).join(' · ') },
        openJob(id) { if (id) uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(id) }) },
        async save() {
            if (this.saving) return
            if (!this.form.jobId) { this.error = '请先关联工单'; return }
            if (!this.form.category || !this.form.description.trim()) { this.error = '请选择类别并描述异常'; return }
            this.saving = true; this.error = ''
            try {
                const record = { jobId: this.form.jobId, category: this.form.category, description: this.form.description.trim() }
                await callOperations('saveException', { record, expectedVersion: 0, requestId: operationRequest(this, 'saveException', record) })
                this.pendingRequest = null
                this.form = { jobId: this.presetJobId || '', category: '', description: '' }
                this.jobChoices = []; this.jobKeyword = ''; this.searched = false
                this.drawerOpen = false
                uni.showToast({ title: '已登记异常', icon: 'success' })
                await this.load()
            } catch (error) {
                this.error = error.message
            } finally {
                this.saving = false
            }
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.exc-head { display: flex; align-items: center; justify-content: space-between;  margin-bottom: var(--sp-12, 12rpx); }
.exc-pending { display: flex; align-items: baseline;  }
.exc-pending-num { color: $warning; font-size: var(--fs-44, 44rpx); font-weight: 700; line-height: 1; }
.exc-pending-label { color: $muted; font-size: var(--fs-24, 24rpx); }
.exc-refresh { width: 60rpx; height: 60rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: $surface; }
.row-list { display: flex; flex-direction: column;  }
.list-end { display: block; text-align: center; padding: var(--sp-16, 16rpx) 0 var(--sp-8, 8rpx); }
.exc-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 90; display: flex; align-items: flex-end; background: rgba(31, 38, 34, .42); }
.exc-sheet { box-sizing: border-box; width: 100%; max-height: 86vh; overflow-y: auto; padding: var(--sp-12, 12rpx) var(--sp-24, 24rpx) calc(var(--sp-20, 20rpx) + env(safe-area-inset-bottom)); border-radius: var(--radius-card, 16rpx) var(--radius-card, 16rpx) 0 0; background: $surface; }
.exc-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-12, 12rpx); }
.exc-sheet-title { font-size: var(--fs-30, 30rpx); font-weight: 700; }
.exc-sheet-close { padding: 0 var(--sp-8, 8rpx); color: $muted; font-size: 40rpx; line-height: 1; }
.exc-error { display: block; margin-bottom: var(--sp-8, 8rpx); color: $danger; font-size: var(--fs-24, 24rpx); line-height: 1.5; }
.exc-search { display: flex; align-items: center;  padding: 0 var(--sp-12, 12rpx); border-radius: var(--radius-button, 12rpx); background: $canvas; }
.exc-search input { flex: 1; min-width: 0; height: 68rpx; font-size: var(--fs-28, 28rpx); }
.exc-search-btn { flex-shrink: 0; color: $primary; font-size: var(--fs-24, 24rpx); padding: var(--sp-12, 12rpx) 0 var(--sp-12, 12rpx) var(--sp-8, 8rpx); }
.exc-choices { display: flex; flex-direction: column;  margin-bottom: var(--sp-12, 12rpx); }
.exc-choice { padding: var(--sp-12, 12rpx); border-radius: var(--radius-button, 12rpx); background: $canvas; }
.exc-choice-title { display: block; font-size: var(--fs-28, 28rpx); font-weight: 600; }
.exc-choice-meta { display: block; margin-top: 2rpx; color: $muted; font-size: var(--fs-24, 24rpx); }
.exc-chips { margin: 0; }
.exc-submit { width: 100%; margin-top: var(--sp-8, 8rpx); }

.exc-head .exc-refresh { margin-left: var(--sp-12, 12rpx); }
.exc-pending-label { margin-left: var(--sp-8, 8rpx); }
.row-list { display: flex; flex-direction: column; }
.row-item + .row-item { margin-top: var(--sp-8, 8rpx); }
.exc-search-btn { margin-left: var(--sp-8, 8rpx); }
.exc-choice + .exc-choice { margin-top: var(--sp-8, 8rpx); }

</style>
