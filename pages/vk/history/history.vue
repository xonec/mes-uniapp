<template>
    <view class="fw-page">
        <view class="fw-header"><text class="fw-subtitle">查找批号，查看保存版本并载入计算。</text></view>
        <view class="fw-search"><input v-model="kw" placeholder="搜索批号，完整批号可查询云端" confirm-type="search" maxlength="30" @confirm="searchRemote" /><text v-if="kw" class="fw-search-clear" @tap="kw = ''">清除</text></view>
        <view class="history-caption"><text>已载入 {{ list.length }} 个批号</text><text @tap="refresh">{{ loading ? '加载中…' : '刷新' }}</text></view>
        <view v-if="error" class="fw-notice error">{{ error }}<button class="fw-button secondary" :disabled="loading" @tap="loadMore">重试加载</button></view>
        <view v-if="searchError" class="fw-notice warning">{{ searchError }}</view>
        <view v-if="loading && !list.length" class="fw-card fw-empty"><text class="fw-empty-title">正在加载记录</text><text class="fw-note">请稍候…</text></view>
        <view v-else-if="!filtered.length && !error" class="fw-card fw-empty"><text class="fw-empty-title">{{ kw ? '已加载记录中没有匹配批号' : '暂无生产记录' }}</text><text class="fw-note">{{ kw ? '输入完整批号可查询云端记录。' : '在计算页保存后，可在这里查看和载入。' }}</text><button v-if="kw" class="fw-button" :disabled="searching" @tap="searchRemote">{{ searching ? '查询中…' : '查询完整批号' }}</button><button v-else class="fw-button" @tap="goCalculation">前往计算</button></view>
        <view v-for="record in filtered" :key="record.batchNo" class="history-item fw-card" @tap="openVersions(record.batchNo)"><view class="history-row"><text class="batch-code">{{ record.batchNo }}</text><text class="version-link">查看版本 ›</text></view><text class="record-time">{{ record.updatedAt ? '最近更新 ' + fmtTime(record.updatedAt) : '生产记录' }}</text></view>
        <button v-if="!done && !error && list.length" class="load-more" :disabled="loading" @tap="loadMore">{{ loading ? '加载中…' : '加载更多记录' }}</button>
        <view v-if="done && list.length && !kw" class="end-note">已加载全部记录</view>
        <view v-if="showVersions" class="sheet-mask" @tap="closeVersions">
            <view class="sheet" @tap.stop>
                <view class="sheet-handle"></view><view class="sheet-head"><view><text class="sheet-title">保存版本</text><text class="sheet-batch">{{ versionBatch }}</text></view><button class="sheet-close" @tap="closeVersions" aria-label="关闭版本列表">×</button></view>
                <scroll-view scroll-y class="sheet-body">
                    <view v-if="versionError" class="fw-notice error">{{ versionError }}<button class="fw-button secondary" @tap="openVersions(versionBatch)">重新加载</button></view>
                    <view v-for="version in versions" :key="version.version" class="version-item"><view class="version-top"><text class="fw-badge" :class="{ muted: !version.isLatest }">{{ version.isLatest ? '最新 · V' : 'V' }}{{ version.version }}</text><text class="fw-note">{{ version.time }}</text></view><view class="version-bottom"><view><text class="version-desc">{{ version.desc }}</text><text v-if="version.order" class="version-order">{{ version.order }}</text></view><button class="fw-button" @tap="loadRecord(version)">载入</button></view></view>
                    <view v-if="verLoading" class="fw-empty"><text class="fw-note">正在加载版本…</text></view><view v-else-if="!versionError && !versions.length" class="fw-empty"><text class="fw-note">暂无保存版本</text></view>
                    <view v-if="historyLimitReached" class="fw-note">此处显示最近 100 个历史版本及最新记录。</view>
                </scroll-view>
            </view>
        </view>
    </view>
</template>
<script>
import { listProductionRecords, listRecordVersions, fetchProductionRecord } from '@/utils/production-db.js'
import { STORE_LOAD_RECORD } from '@/utils/storage-keys.js'
import { getUser } from '@/utils/auth.js'
import { callCloud } from '@/utils/vk-records-api.js'
import { openPage } from '@/utils/vk-migration.js'
import { batchIsValid } from '@/utils/shared/batch.js'
export default {
    data() { return { list: [], kw: '', cursor: 0, done: false, loading: false, error: '', searching: false, searchError: '', requestNo: 0, searchRequest: 0, showVersions: false, versionBatch: '', versions: [], verLoading: false, versionError: '', historyLimitReached: false, versionRequest: 0 } },
    computed: { filtered() { const keyword = this.kw.trim().toUpperCase(); return keyword ? this.list.filter(row => row.batchNo.toUpperCase().includes(keyword)) : this.list } },
    watch: { kw() { this.searchRequest++; this.searching = false; this.searchError = '' } },
    onShow() { if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }; this.refresh() },
    onHide() { this.cancelRequests() },
    onUnload() { this.cancelRequests() },
    methods: {
        cancelRequests() { this.requestNo++; this.searchRequest++; this.versionRequest++; this.loading = false; this.searching = false; this.verLoading = false; this.showVersions = false },
        goCalculation() { openPage('materials') },
        async refresh() { if (this.loading) return; this.searchRequest++; this.searching = false; this.requestNo++; this.cursor = 0; this.done = false; this.list = []; this.error = ''; this.searchError = ''; await this.loadMore() },
        async loadMore() {
            if (this.loading || this.done) return
            const request = ++this.requestNo
            this.loading = true; this.error = ''
            try {
                const page = await listProductionRecords(50, this.cursor, callCloud)
                if (request !== this.requestNo) return
                const remote = (page.list || []).filter(row => row.batchNo)
                this.list = [...this.list, ...remote.filter(row => !this.list.some(existing => existing.batchNo === row.batchNo))]
                this.cursor = page.nextBefore || 0; this.done = !page.hasMore
            } catch (error) { if (request === this.requestNo) this.error = error.message || '记录加载失败，请重试' }
            finally { if (request === this.requestNo) this.loading = false }
        },
        async searchRemote() {
            if (this.searching) return
            const batch = this.kw.trim().toUpperCase()
            if (!batchIsValid(batch)) { uni.showToast({ title: '云端查询请填写完整批号（含 B 单后缀）', icon: 'none' }); return }
            const request = ++this.searchRequest
            this.searching = true; this.searchError = ''
            try { const record = await fetchProductionRecord(batch, callCloud); if (request !== this.searchRequest) return; if (!record) { this.searchError = '云端没有此批号的生产记录。'; return }; if (!this.list.some(row => row.batchNo === batch)) this.list.unshift({ batchNo: batch, updatedAt: record.updatedAt || record.savedAt }); await this.openVersions(batch) }
            catch (error) { if (request === this.searchRequest) this.searchError = error.message || '云端查询失败，请重试' }
            finally { if (request === this.searchRequest) this.searching = false }
        },
        closeVersions() { this.showVersions = false; this.versionRequest++; this.verLoading = false },
        async openVersions(batch) {
            const request = ++this.versionRequest
            this.versionBatch = batch; this.showVersions = true; this.versions = []; this.versionError = ''; this.historyLimitReached = false; this.verLoading = true
            try {
                const [latest, history] = await Promise.all([fetchProductionRecord(batch, callCloud), listRecordVersions(batch, 100, callCloud)])
                if (request !== this.versionRequest) return
                this.historyLimitReached = history.length >= 100
                const versions = latest ? [{ version: latest.version || 1, isLatest: true, record: latest, savedAt: latest.savedAt }] : []
                history.forEach(row => { if (!versions.some(version => version.version === row.version)) versions.push({ version: row.version, isLatest: false, record: row.snapshot, savedAt: row.savedAt }) })
                this.versions = versions.sort((a, b) => b.version - a.version).map(version => { const record = version.record || {}; return { ...version, time: this.fmtTime(version.savedAt), desc: `${record.caseCount || 0} 件 · ${record.bucketCount || 0} 桶`, order: record.orderNo ? '订单 ' + record.orderNo + ' · V' + (record.orderVersion || '—') : '' } })
            } catch (error) { if (request === this.versionRequest) this.versionError = error.message || '版本加载失败，请重试' }
            finally { if (request === this.versionRequest) this.verLoading = false }
        },
        loadRecord(version) { if (!version.record) return; uni.setStorageSync(STORE_LOAD_RECORD, version.record); this.closeVersions(); this.goCalculation() },
        fmtTime(value) { if (!value) return ''; const date = new Date(value); if (isNaN(date.getTime())) return String(value); const pad = number => String(number).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.history-caption, .history-row { display: flex; justify-content: space-between; align-items: center;  }.history-caption { font-size: 24rpx; color: $muted; margin-bottom: 20rpx; }.history-caption text:last-child { color: $primary; padding: 8rpx 0; }.batch-code { font-weight: 700; font-size: 32rpx; letter-spacing: 1.3rpx; }.version-link { color: $primary; font-size: 25.6rpx; flex-shrink: 0; }.record-time { display: block; color: $muted; font-size: 24rpx; margin-top: 12rpx; }
.load-more { margin: 16rpx 0; font-size: 27.2rpx; line-height: 89.6rpx; background: $surface; color: $primary; border-radius: 19.2rpx; }.load-more::after { border: 0; }.end-note { text-align: center; color: $muted; font-size: 24rpx; padding: 20rpx; }.fw-notice .fw-button { margin-top: 12rpx; }
.sheet-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: $overlay; display: flex; align-items: flex-end; z-index: 99; }.sheet { box-sizing: border-box; background: $surface; width: 100%; border-radius: 32rpx 32rpx 0 0; padding: 12rpx 20rpx calc(16rpx + env(safe-area-inset-bottom)); max-height: 80vh; }.sheet-handle { width: 76.8rpx; height: 8rpx; background: $line; border-radius: 6.4rpx; margin: 0 auto 16rpx; }.sheet-head { display: flex; align-items: center; justify-content: space-between;  margin-bottom: 20rpx; }.sheet-title { font-weight: 700; font-size: 35.2rpx; display: block; }.sheet-batch { font-size: 25.6rpx; color: $muted; display: block; margin-top: 6rpx; }.sheet-close { padding: 0; margin: 0; width: 83.2rpx; height: 83.2rpx; line-height: 83.2rpx; font-size: 44.8rpx; border-radius: 50%; background: $canvas; color: $muted; }.sheet-close::after { border: 0; }.sheet-body { height: 55vh; }
.version-item { border: 1px solid $line; border-radius: 19.2rpx; padding: 18rpx; margin-bottom: 14rpx; }.version-top { display: flex; justify-content: space-between; align-items: center;  }.version-top .fw-note { font-size: 22.4rpx; }.version-bottom { display: flex; align-items: center; justify-content: space-between;  margin-top: 14rpx; }.version-bottom > view { flex: 1; min-width: 0; }.version-bottom .fw-button { font-size: 25.6rpx; min-height: 76.8rpx; line-height: 76.8rpx; padding: 0 16rpx; }.version-desc { display: block; font-size: 28.8rpx; }.version-order { display: block; font-size: 24rpx; color: $muted; margin-top: 8rpx; }

.history-caption { display: flex; justify-content: space-between; align-items: center; }
.history-row { display: flex; justify-content: space-between; align-items: center; }
.history-caption text + text { margin-left: 12rpx; }
.history-row .version-link { margin-left: 12rpx; }
.sheet-close { margin-left: 20rpx; }
.version-top .fw-note { margin-left: 12rpx; }
.version-bottom .fw-button { margin-left: 16rpx; }

</style>
