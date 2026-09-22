// 历史记录 + 版本列表 / 回滚（从 materials.vue 抽出）
//
// 使用方需提供：loadRecord(rec)（把一条记录灌进当前表单）
// 使用方需在模板中绑定：historyShow / historyList / versionShow / versionList 等。

import { STORE_HISTORY } from '@/utils/storage-keys.js'
import {
    fetchProductionRecord,
    listProductionRecords,
    listRecordVersions,
    rollbackProductionRecord
} from '@/utils/production-db.js'

export default {
    data() {
        return {
            // 历史
            historyShow: false,
            historyList: [],
            historyKeyword: '',
            historyCursor: 0,
            historyDone: false,
            historyLoading: false,
            // 历史版本
            versionShow: false,
            versionList: [],
            versionBatch: '',
            versionLoading: false
        }
    },
    computed: {
        filteredHistory() {
            const kw = (this.historyKeyword || '').trim().toUpperCase()
            const src = this.historyList || []
            if (!kw) return src
            return src.filter(b => String(b).toUpperCase().indexOf(kw) >= 0)
        }
    },
    methods: {
        async openHistory() {
            this.historyShow = true
            // 30 秒内有缓存直接用，避免反复开关重复请求
            if (this._historyCacheAt && Date.now() - this._historyCacheAt < 30000) {
                return
            }
            this.historyKeyword = ''
            this.historyCursor = 0
            this.historyDone = false
            // 先用本地历史即时显示，再合并云端；本地独有的也保留，避免「云端非空时丢本地」
            this.historyList = uni.getStorageSync(STORE_HISTORY) || []
            await this.loadMoreHistory()
            this._historyCacheAt = Date.now()
        },
        async loadMoreHistory() {
            if (this.historyLoading || this.historyDone) return
            this.historyLoading = true
            try {
                const page = await listProductionRecords(50, this.historyCursor)
                const remote = (page.list || []).map(r => r.batchNo).filter(Boolean)
                const merged = [...this.historyList, ...remote.filter(x => this.historyList.indexOf(x) < 0)]
                this.historyList = merged
                this.historyCursor = page.nextBefore || 0
                if (!page.hasMore) this.historyDone = true
            } catch (e) {
                console.warn('[cloud] 读取云端历史失败：', e && e.message)
                this.historyDone = true
            } finally {
                this.historyLoading = false
            }
        },
        async openVersions(b) {
            this.versionBatch = b
            this.versionShow = true
            this.versionList = []
            this.versionLoading = true
            try {
                // 并行请求：最新版（主表）+ 历史版本（历史表），省一半往返
                const [latest, vers] = await Promise.all([
                    fetchProductionRecord(b),
                    listRecordVersions(b)
                ])
                const list = []
                if (latest) {
                    list.push({ version: latest.version || 1, isLatest: true, savedAt: latest.savedAt, record: latest })
                }
                vers.forEach(v => {
                    list.push({ version: v.version, isLatest: false, savedAt: v.savedAt, record: v.snapshot })
                })
                list.sort((x, y) => (y.version || 0) - (x.version || 0))
                this.versionList = list.map(v => {
                    const r = v.record || {}
                    return {
                        version: v.version,
                        isLatest: v.isLatest,
                        record: r,
                        time: this.fmtTime(v.savedAt),
                        desc: `${r.caseCount || 0} 件 · ${r.bucketCount || 0} 桶`
                    }
                })
            } catch (e) {
                console.warn('[cloud] 读取版本列表失败：', e && e.message)
            } finally {
                this.versionLoading = false
            }
        },
        fmtTime(iso) {
            if (!iso) return ''
            const d = new Date(iso)
            if (isNaN(d.getTime())) return String(iso)
            const p = n => String(n).padStart(2, '0')
            return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
        },
        loadVersion(v) {
            const rec = v.record
            this.closeHistory()
            if (rec) this.loadRecord(rec)
        },
        rollbackVersion(v) {
            uni.showModal({
                title: '回滚确认',
                content: `确定把该批号回滚到 v${v.version} 吗？回滚后会成为最新版本。`,
                success: async (res) => {
                    if (!res.confirm) return
                    try {
                        await rollbackProductionRecord(this.versionBatch, v.version)
                        uni.showToast({ title: '已回滚', icon: 'success' })
                        await this.openVersions(this.versionBatch)
                    } catch (e) {
                        uni.showToast({ title: '回滚失败：' + (e.message || e), icon: 'none' })
                    }
                }
            })
        },
        closeHistory() {
            this.historyShow = false
            this.versionShow = false
        }
    }
}
