<template>
    <view class="page">
        <view class="search-bar">
            <input class="search-inp" v-model="kw" placeholder="搜索批号" confirm-type="search" />
        </view>
        <scroll-view scroll-y class="body">
            <view class="hist-item" v-for="(b, i) in filtered" :key="i" @tap="openVersions(b)">
                <text class="code">{{ b }}</text>
                <text class="arrow">版本 ›</text>
            </view>
            <view v-if="loading && list.length === 0" class="empty">加载中…</view>
            <view v-else-if="filtered.length === 0" class="empty">暂无记录</view>
            <view v-else-if="!done" class="load-more" @tap="loadMore">{{ loading ? '加载中…' : '加载更多' }}</view>
        </scroll-view>

        <!-- 版本弹层 -->
        <view class="sheet-mask" v-if="showVersions" @tap="showVersions = false">
            <view class="sheet" @tap.stop>
                <view class="sheet-head">
                    <text class="back" @tap="showVersions = false">‹ 返回</text>
                    <text class="count">{{ versionBatch }}</text>
                </view>
                <scroll-view scroll-y class="sheet-body">
                    <view class="ver-item" v-for="(v, i) in versions" :key="i">
                        <view class="ver-info">
                            <text class="ver-tag" :class="{ latest: v.isLatest }">{{ v.isLatest ? '最新' : 'v' + v.version }}</text>
                            <text class="ver-time">{{ v.time }}</text>
                            <text class="ver-desc">{{ v.desc }}</text>
                        </view>
                        <button class="btn mini" @tap="loadRecord(v)">载入</button>
                    </view>
                    <view v-if="verLoading" class="empty">加载中…</view>
                    <view v-else-if="versions.length === 0" class="empty">暂无版本</view>
                </scroll-view>
            </view>
        </view>
    </view>
</template>

<script>
// 历史记录独立页：生产记录列表（游标分页）+ 版本列表 + 载入到计算页
import { listProductionRecords, listRecordVersions, fetchProductionRecord } from '@/utils/production-db.js'
import { STORE_LOAD_RECORD } from '@/utils/storage-keys.js'
import { getUser } from '@/utils/auth.js'

export default {
    data() {
        return {
            list: [],
            kw: '',
            cursor: 0,
            done: false,
            loading: false,
            showVersions: false,
            versionBatch: '',
            versions: [],
            verLoading: false
        }
    },
    computed: {
        filtered() {
            const k = (this.kw || '').trim().toUpperCase()
            if (!k) return this.list
            return this.list.filter(b => String(b).toUpperCase().indexOf(k) >= 0)
        }
    },
    onShow() {
        if (!getUser()) {
            uni.reLaunch({ url: '/pages/login/login' })
            return
        }
        this.refresh()
    },
    methods: {
        async refresh() {
            this.cursor = 0
            this.done = false
            this.list = []
            await this.loadMore()
        },
        async loadMore() {
            if (this.loading || this.done) return
            this.loading = true
            try {
                const page = await listProductionRecords(50, this.cursor)
                const remote = (page.list || []).map(r => r.batchNo).filter(Boolean)
                this.list = [...this.list, ...remote.filter(x => this.list.indexOf(x) < 0)]
                this.cursor = page.nextBefore || 0
                if (!page.hasMore) this.done = true
            } catch (e) {
                this.done = true
            } finally {
                this.loading = false
            }
        },
        async openVersions(b) {
            this.versionBatch = b
            this.showVersions = true
            this.versions = []
            this.verLoading = true
            try {
                const [latest, vers] = await Promise.all([
                    fetchProductionRecord(b),
                    listRecordVersions(b)
                ])
                const list = []
                if (latest) {
                    list.push({ version: latest.version || 1, isLatest: true, record: latest, savedAt: latest.savedAt })
                }
                vers.forEach(v => {
                    list.push({ version: v.version, isLatest: false, record: v.snapshot, savedAt: v.savedAt })
                })
                list.sort((x, y) => (y.version || 0) - (x.version || 0))
                this.versions = list.map(v => {
                    const r = v.record || {}
                    return {
                        version: v.version,
                        isLatest: v.isLatest,
                        record: v.record,
                        time: this.fmtTime(v.savedAt),
                        desc: `${r.caseCount || 0} 件 · ${r.bucketCount || 0} 桶`
                    }
                })
            } catch (e) {
                console.warn('[history] 读取版本列表失败：', e && e.message)
            } finally {
                this.verLoading = false
            }
        },
        // 载入：把该版本记录暂存，切到计算页回填表单
        loadRecord(v) {
            const rec = v.record
            if (!rec) return
            uni.setStorageSync(STORE_LOAD_RECORD, rec)
            this.showVersions = false
            uni.switchTab({ url: '/pages/materials/materials' })
        },
        fmtTime(iso) {
            if (!iso) return ''
            const d = new Date(iso)
            if (isNaN(d.getTime())) return String(iso)
            const p = n => String(n).padStart(2, '0')
            return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
        }
    }
}
</script>

<style scoped>
.page { padding: 16rpx; min-height: 100vh; background: #F2F4F3; }
.search-bar { padding: 4rpx 0 12rpx; }
.search-inp { height: 64rpx; background: #fff; border-radius: 12rpx; padding: 0 20rpx; font-size: 26rpx; }
.hist-item { display: flex; justify-content: space-between; padding: 24rpx 8rpx; border-bottom: 1rpx solid #F0F3F1; background: #fff; margin-bottom: 10rpx; border-radius: 12rpx; padding: 22rpx 18rpx; }
.code { font-size: 28rpx; font-weight: 600; color: #1f2622; }
.arrow { color: #008577; font-size: 26rpx; }
.empty { text-align: center; color: #bbb; padding: 60rpx; font-size: 24rpx; }
.load-more { text-align: center; color: #008577; font-size: 24rpx; padding: 20rpx 0; }
.sheet-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: flex-end; z-index: 99; }
.sheet { background: #fff; width: 100%; border-radius: 24rpx 24rpx 0 0; padding: 24rpx; max-height: 70vh; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.sheet-body { max-height: 50vh; }
.back { color: #008577; font-size: 28rpx; font-weight: 700; }
.count { color: #77827D; font-size: 26rpx; }
.ver-item { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 8rpx; border-bottom: 1rpx solid #F0F3F1; }
.ver-item:last-child { border-bottom: none; }
.ver-info { display: flex; align-items: center; gap: 12rpx; flex: 1; min-width: 0; }
.ver-tag { font-size: 20rpx; color: #77827D; background: #F2F4F3; padding: 2rpx 10rpx; border-radius: 999rpx; flex-shrink: 0; }
.ver-tag.latest { background: #008577; color: #fff; }
.ver-time { font-size: 22rpx; color: #77827D; flex-shrink: 0; }
.ver-desc { font-size: 22rpx; color: #1f2622; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 18rpx; height: 64rpx; line-height: 64rpx; background: #EEF3F1; color: #1f2622; }
.btn.mini { height: 48rpx; line-height: 48rpx; font-size: 22rpx; padding: 0 16rpx; border-radius: 10rpx; }
.btn.mini { background: #E6F4F1; color: #008577; }
</style>
