<template>
    <page-meta :disable-scroll="dragMode"></page-meta>
    <view class="page" @touchmove="onDragMove" @touchend="endDrag" @touchcancel="endDrag">
        <view v-if="isAdmin" class="admin-strip" @tap="goUserManage">
            <text class="as-ico">⚙</text>
            <text class="as-txt">用户管理</text>
            <text class="as-arrow">›</text>
        </view>
        <!-- #ifdef MP-WEIXIN -->
        <button class="share-fab" open-type="share">分享</button>
        <!-- #endif -->
        <view v-for="(c, idx) in cardList" :key="c.key" class="card" :class="{ dragging: dragMode && c.key === dragKey }">
            <view class="card-head" @tap="toggleCard(c.key)" @longpress="startDrag(c.key, idx, $event)">
                <view class="card-head-left">
                    <text class="card-title">{{ c.title }}</text>
                    <text v-if="c.key==='buckets'" class="hint">按 A → J 顺序录入</text>
                    <text v-else-if="c.key==='prod'" class="hint">自动结果只读</text>
                    <text v-else-if="c.key==='material'" class="chip">实用自动</text>
                    <text v-else-if="c.key==='weight'" class="chip" :class="{active: !!weightProduct}">{{ weightProduct || '未选择产品' }}</text>
                    <text v-else-if="c.key==='pallet'" class="chip">{{ palletPage }}</text>
                </view>
                <view class="card-tools">
                    <text class="drag-hint">≡</text>
                    <text class="collapse-btn" @tap.stop="toggleCard(c.key)">{{ c.collapsed ? '▸' : '▾' }}</text>
                </view>
            </view>
            <view v-show="!c.collapsed" class="card-body">
                <!-- 批号 / 产品 -->
                <template v-if="c.key==='batch'">
                    <view class="cmd-grid">
                        <view class="cmd-info">
                            <view class="inline-field">
                                <text class="lbl">产品编码</text>
                                <input class="inp" v-model="productCode" type="text" maxlength="10"
                                    placeholder="按批号前四位筛选" @input="onProductInput" />
                            </view>
                            <view class="inline-field">
                                <text class="lbl">批号</text>
                                <view class="scan-input">
                                    <input class="inp" v-model="batchNo" type="text" maxlength="11"
                                        placeholder="11位英文+数字" @input="onBatchInput" />
                                    <button class="scan-mini" @tap="scanBatch" aria-label="扫码">⊞</button>
                                </view>
                            </view>
                        </view>
                        <view class="cmd-actions">
                            <button class="btn primary" @tap="smartFill">智能填充</button>
                            <button class="btn" @tap="chooseProduct">选择产品</button>
                        </view>
                    </view>
                    <view class="fr-bar">
                        <button class="btn cloud-btn" :disabled="!batchValid || cloudFetching" @tap="fetchFromCloud">
                            {{ cloudFetching ? '获取中…' : '从云端获取每桶件数' }}
                        </button>
                        <button v-if="isAndroid" class="btn fr-btn" :disabled="!batchValid || fetching" @tap="fetchFromFr">
                            {{ fetching ? '获取中…' : '从帆软(内网)获取' }}
                        </button>
                        <text class="fr-hint" v-if="!batchValid">输入有效批号后可用</text>
                        <text class="fr-hint" v-else-if="frMsg">{{ frMsg }}</text>
                        <text class="fr-hint" v-else-if="cloudMsg">{{ cloudMsg }}</text>
                    </view>
                </template>
                <!-- 分桶件数 -->
                <template v-else-if="c.key==='buckets'">
                    <view class="bucket-grid">
                        <view class="bucket" v-for="(key, idx2) in bucketKeys" :key="key">
                            <text class="blbl">{{ key }}桶</text>
                            <input class="binp" type="number" min="0" :disabled="isBucketDisabled(idx2)"
                                :placeholder="'0'" v-model="buckets[key]" @input="calculateMaterial" />
                        </view>
                    </view>
                    <view class="data-grid bucket-tail">
                        <view class="data-cell">
                            <text class="dlbl">零箱（瓶）</text>
                            <input class="dinp" type="number" min="0" v-model="zeroCount" @input="calculateMaterial" />
                        </view>
                        <view class="data-cell">
                            <text class="dlbl">瓶 / 件</text>
                            <input class="dinp" type="number" min="1" v-model="perCase" @input="calculateMaterial" />
                        </view>
                        <view class="data-cell">
                            <text class="dlbl">件 / 托</text>
                            <input class="dinp" type="number" min="1" v-model="perPallet" @input="calculateMaterial" />
                        </view>
                    </view>
                </template>
                <!-- 生产数据 -->
                <template v-else-if="c.key==='prod'">
                    <view class="data-grid">
                        <view class="data-cell"><text class="dlbl">入库瓶数</text><text class="dval">{{ inboundCount }}</text></view>
                        <view class="data-cell">
                            <text class="dlbl">取样数（瓶）</text>
                            <input class="dinp" type="number" min="0" v-model="sampleCount" @input="calculateMaterial" />
                        </view>
                        <view class="data-cell"><text class="dlbl">领用内包数</text><text class="dval">{{ innerIssued }}</text></view>
                        <view class="data-cell"><text class="dlbl">桶数</text><text class="dval">{{ bucketCount }}</text></view>
                        <view class="data-cell"><text class="dlbl">入库数</text><text class="dval">{{ caseCountText }}</text></view>
                        <view class="data-cell"><text class="dlbl">托码</text><text class="dval">{{ palletCode }}</text></view>
                    </view>
                    <view class="seg-row">
                        <text class="dlbl">本批状态</text>
                        <view class="seg">
                            <view class="seg-item" :class="{ active: batchStatus === 'incomplete' }" @tap="batchStatus = 'incomplete'">未完成</view>
                            <view class="seg-item" :class="{ active: batchStatus === 'complete' }" @tap="batchStatus = 'complete'">已完成</view>
                        </view>
                    </view>
                    <view class="sync-line"><text>保存后自动同步云端</text></view>
                    <view class="btn-row">
                        <button class="btn primary" @tap="save">保存</button>
                        <button class="btn" @tap="openHistory">历史</button>
                        <button class="btn danger" @tap="clearAll">清空</button>
                    </view>
                </template>
                <!-- 包材卡片 -->
                <template v-else-if="c.key==='material'">
                    <view class="material-addons">
                        <view class="data-cell"><text class="dlbl">标签追加（张）</text><input class="dinp" type="number" min="0" placeholder="0" v-model="labelExtra" @input="calculateMaterial" /></view>
                        <view class="data-cell"><text class="dlbl">防伪追加（张）</text><input class="dinp" type="number" min="0" placeholder="0" v-model="securityExtra" @input="calculateMaterial" /></view>
                    </view>
                    <view class="material-table">
                        <view class="material-row head"><text>包材</text><text>领用</text><text>实用</text><text>损耗</text><text>退回</text></view>
                        <view class="material-row" v-for="(m, i) in materials" :key="i">
                            <text class="mname">{{ m.name }}</text>
                            <input class="minp" type="number" min="0" placeholder="0" v-model="m.issued" />
                            <input class="minp used" :value="m.used" disabled />
                            <input class="minp" type="number" min="0" placeholder="0" v-model="m.loss" />
                            <input class="minp" type="number" min="0" placeholder="0" v-model="m.returned" />
                        </view>
                    </view>
                    <text class="hint pad">实用数按生产数据自动计算；领用、损耗、退回可选填，随保存记录。</text>
                </template>
                <!-- 重量参数 -->
                <template v-else-if="c.key==='weight'">
                    <view class="data-grid">
                        <view class="data-cell"><text class="dlbl">单箱净重（kg）</text><input class="dinp" type="digit" v-model="boxNetWeight" @input="updateWeightRange" /></view>
                        <view class="data-cell"><text class="dlbl">单瓶重量（kg）</text><input class="dinp" type="digit" v-model="bottleWeight" @input="updateWeightRange" /></view>
                        <view class="data-cell"><text class="dlbl">重量范围</text><text class="dval">{{ weightRange }}</text></view>
                        <view class="data-cell"><text class="dlbl">单瓶最低（kg）</text><input class="dinp" type="digit" v-model="bottleWeightMin" @input="updateWeightRange" /></view>
                        <view class="data-cell"><text class="dlbl">单箱净重最低（kg）</text><input class="dinp" type="digit" v-model="boxNetWeightMin" @input="updateWeightRange" /></view>
                    </view>
                </template>
                <!-- 托分页 -->
                <template v-else-if="c.key==='pallet'">
                    <view class="inline-field pager-summary"><text>件号</text><text class="strong">{{ palletRange }}</text></view>
                    <view class="inline-field pager-summary" v-if="zeroBoxInfo && currentPallet === totalPallets"><text>零箱</text><text class="strong">{{ zeroBoxInfo }}</text></view>
                    <view class="pager-actions">
                        <button class="btn" @tap="goPallet('first')">首托</button>
                        <button class="btn" @tap="goPallet('prev')">上一托</button>
                        <button class="btn primary" @tap="goPallet('next')">下一托</button>
                        <button class="btn" @tap="goPallet('last')">尾托</button>
                    </view>
                </template>
            </view>
        </view>

        <view style="height: 40rpx"></view>

        <!-- 历史弹层 -->
        <view class="sheet-mask" v-if="historyShow" @tap="closeHistory">
            <view class="sheet" @tap.stop>
                <!-- 批号列表 -->
                <view v-if="!versionShow">
                    <view class="sheet-head"><text>历史记录</text><text class="count">{{ historyList.length }} 条</text></view>
                    <view class="search-bar">
                        <input class="search-inp" v-model="historyKeyword" placeholder="搜索批号" confirm-type="search" />
                    </view>
                    <scroll-view scroll-y class="sheet-body">
                        <view class="hist-item" v-for="(b, i) in filteredHistory" :key="i" @tap="openVersions(b)">
                            <text class="code">{{ b }}</text>
                            <text class="arrow">版本 ›</text>
                        </view>
                        <view v-if="historyLoading && filteredHistory.length===0" class="empty">加载中…</view>
                        <view v-else-if="filteredHistory.length===0" class="empty">暂无匹配</view>
                        <view v-else-if="!historyDone" class="load-more" @tap="loadMoreHistory">{{ historyLoading ? '加载中…' : '加载更多' }}</view>
                    </scroll-view>
                </view>
                <!-- 版本列表 -->
                <view v-else>
                    <view class="sheet-head">
                        <text class="back" @tap="versionShow=false">‹ 返回</text>
                        <text class="count">{{ versionBatch }}</text>
                    </view>
                    <scroll-view scroll-y class="sheet-body">
                        <view class="ver-item" v-for="(v, i) in versionList" :key="i">
                            <view class="ver-info">
                                <text class="ver-tag" :class="{ latest: v.isLatest }">{{ v.isLatest ? '最新' : 'v' + v.version }}</text>
                                <text class="ver-time">{{ v.time }}</text>
                                <text class="ver-desc">{{ v.desc }}</text>
                            </view>
                            <view class="ver-actions">
                                <button class="btn mini" @tap="loadVersion(v)">载入</button>
                                <button class="btn mini danger" v-if="!v.isLatest" @tap="rollbackVersion(v)">回滚</button>
                            </view>
                        </view>
                        <view v-if="versionLoading" class="empty">加载中…</view>
                        <view v-else-if="versionList.length===0" class="empty">暂无版本</view>
                    </scroll-view>
                </view>
                <button class="btn" @tap="closeHistory">关闭</button>
            </view>
        </view>
    </view>
</template>

<script>
import { productCatalog, exactBatch, batchIsValid, resolveProduct, productMatches } from '@/utils/product-data.js'
import { isAppAndroid, fetchBatchBucketQtys } from '@/utils/fr-fetch.js'
import { fetchBatchBucketsFromCloud, upsertBatchBuckets } from '@/utils/cloud-db.js'
import { getDeviceId } from '@/utils/device.js'
import { saveProductionRecord, fetchProductionRecord, listProductionRecords, listRecordVersions, rollbackProductionRecord, saveDraftRecord, getDraftRecord } from '@/utils/production-db.js'
import { getUser, checkLogin } from '@/utils/auth.js'
import { computeMaterial, computeWeightRange } from '@/utils/calc.js'

const bucketKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
const STORE_RESULTS = 'mes-material-results'
const STORE_HISTORY = 'mes-production-history'
const STORE_DRAFT = 'mes-production-draft'
const STORE_LAYOUT = 'mes-card-layout'
const STORE_SHARE_BATCH = 'mes-share-batch'
// 卡片定义（默认顺序与标题）
const CARD_DEFS = [
    { key: 'batch', title: '批号 / 产品' },
    { key: 'buckets', title: '分桶件数' },
    { key: 'prod', title: '生产数据' },
    { key: 'material', title: '包材卡片' },
    { key: 'weight', title: '重量参数' },
    { key: 'pallet', title: '托分页' }
]
const CARD_KEYS = CARD_DEFS.map(c => c.key)

export default {
    data() {
        const buckets = {}
        bucketKeys.forEach(k => { buckets[k] = '' })
        return {
            isAndroid: false,
            adminChecked: false,
            isAdminVerified: false,
            bucketKeys,
            productCode: '',
            batchNo: '',
            buckets,
            zeroCount: '',
            perCase: '',
            perPallet: '',
            sampleCount: '',
            labelExtra: '',
            securityExtra: '',
            bottleWeight: '',
            bottleWeightMin: '',
            boxNetWeight: '',
            boxNetWeightMin: '',
            currentPallet: 1,
            totalPallets: 1,
            // 自动结果
            inboundCount: '0 瓶',
            innerIssued: '0 瓶',
            bucketCount: 0,
            caseCount: 0,
            caseCountText: '0',
            zeroBoxInfo: '',
            palletCode: '0 托',
            palletPage: '第 1 托 / 共 1 托',
            palletRange: '暂无件号',
            weightRange: '—',
            weightProduct: '',
            materials: [],
            lastCalculation: {},
            // 安卓拉取
            fetching: false,
            frMsg: '',
            cloudFetching: false,
            cloudMsg: '',
            // 本批状态：incomplete | complete
            batchStatus: 'incomplete',
            // 历史
            historyShow: false,
            historyList: [],
            historyKeyword: '',
            historyLoaded: 0,
            historyDone: false,
            historyLoading: false,
            // 历史版本
            versionShow: false,
            versionList: [],
            versionBatch: '',
            versionLoading: false,
            // 卡片折叠与排序（顺序由 cardList 数组决定）
            cardList: CARD_DEFS.map(c => ({ key: c.key, title: c.title, collapsed: false })),
            // 拖拽排序状态
            dragMode: false,
            dragKey: '',
            dragIndex: -1,
            dragY: 0,
            cardTops: [],
            cardH: 0
        }
    },
    computed: {
        batchValid() {
            return batchIsValid(this.batchNo)
        },
        isAdmin() {
            // 服务端复核结果优先；未复核完成时回退本地判断（避免闪烁）
            if (this.adminChecked) return this.isAdminVerified
            const u = getUser()
            return !!(u && u.role && u.role.indexOf('admin') >= 0)
        },
        filteredHistory() {
            const kw = (this.historyKeyword || '').trim().toUpperCase()
            const src = this.historyList || []
            if (!kw) return src
            return src.filter(b => String(b).toUpperCase().indexOf(kw) >= 0)
        }
    },
    onLoad(options) {
        options = options || {}
        // 分享带批号进入：先解析批号
        let sharedBatch = ''
        if (options.batchNo && batchIsValid(options.batchNo)) {
            sharedBatch = String(options.batchNo).toUpperCase()
        }
        // 未登录（如通过分享链接直接进入）：先暂存分享批号，跳登录，登录后回来看数据
        if (!getUser()) {
            if (sharedBatch) uni.setStorageSync(STORE_SHARE_BATCH, sharedBatch)
            uni.reLaunch({ url: '/pages/login/login' })
            return
        }
        // #ifdef APP-PLUS
        this.isAndroid = isAppAndroid()
        // #endif
        // #ifdef MP-WEIXIN
        this.isAndroid = false
        // #endif
        // 服务端复核管理员身份（防本地篡改 role），完成后覆盖本地判断
        this.adminChecked = false
        checkLogin().then(info => {
            if (info) {
                const u = getUser() || {}
                u.role = info.role || []
                uni.setStorageSync('mes_user', u)
                this.isAdminVerified = (info.role || []).indexOf('admin') >= 0
            }
            this.adminChecked = true
        }).catch(() => { this.adminChecked = true })
        this.loadCardLayout()
        // 分享带批号进入：优先从云端加载该批号数据
        if (sharedBatch) {
            this.batchNo = sharedBatch
            this.resolveProductOptions()
            this.loadSharedBatch(sharedBatch)
            return
        }
        // 恢复草稿：优先云端（设备私有），本地兜底
        const draft = uni.getStorageSync(STORE_DRAFT)
        if (draft && draft.batchNo) {
            this.loadRecord(draft)
            uni.showToast({ title: '已恢复草稿', icon: 'none' })
            // 尝试从云端读本设备草稿（可能更新），成功后覆盖
            getDraftRecord(getDeviceId(), draft.batchNo).then(remote => {
                if (remote) this.loadRecord(remote)
            }).catch(() => {})
        } else {
            this.calculateMaterial()
        }
    },
    onShareAppMessage() {
        const title = this.batchValid ? `批号 ${this.batchNo} · 包材计算` : 'MES生产助手 - 包材计算'
        return {
            title,
            path: '/pages/materials/materials' + (this.batchValid ? '?batchNo=' + this.batchNo : '')
        }
    },
    onShareTimeline() {
        const title = this.batchValid ? `批号 ${this.batchNo} · 包材计算` : 'MES生产助手 - 包材计算'
        return {
            title,
            query: this.batchValid ? 'batchNo=' + this.batchNo : ''
        }
    },
    methods: {
        isBucketDisabled(idx) {
            if (idx === 0) return false
            const prev = Number(this.buckets[this.bucketKeys[idx - 1]]) || 0
            return prev <= 0
        },
        onBatchInput(e) {
            let v = (e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
            this.batchNo = v
            this.resolveProductOptions()
        },
        onProductInput(e) {
            let v = (e.detail.value || '').replace(/\D/g, '').slice(0, 10)
            this.productCode = v
            this.applyProduct(v)
        },
        resolveProductOptions() {
            const exact = exactBatch[this.batchNo]
            const matches = productMatches(this.batchNo)
            if (exact) {
                this.productCode = exact.productCode
                this.applyProduct(exact.productCode)
            } else if (matches.length === 1) {
                this.productCode = matches[0].code
                this.applyProduct(matches[0].code)
            }
        },
        smartFill() {
            const r = resolveProduct(this.batchNo)
            if (r) {
                this.productCode = r.productCode || ''
                if (r.perCase) this.perCase = r.perCase
                if (r.perPallet) this.perPallet = r.perPallet
                this.applyProduct(this.productCode)
                uni.showToast({ title: '已智能填充', icon: 'none' })
            } else {
                uni.showToast({ title: this.batchValid ? '存在多个产品编码，请选择' : '请先输入有效批号', icon: 'none' })
            }
        },
        chooseProduct() {
            if (!this.batchValid) {
                uni.showToast({ title: '请先输入有效批号', icon: 'none' })
                return
            }
            const matches = productMatches(this.batchNo)
            if (matches.length === 0) {
                uni.showToast({ title: '未匹配到产品编码', icon: 'none' })
                return
            }
            uni.showActionSheet({
                itemList: matches.map(m => `${m.name}（${m.perCase}瓶/件 · ${m.perPallet}件/托）`),
                success: (res) => {
                    const p = matches[res.tapIndex]
                    this.productCode = p.code
                    this.perCase = p.perCase
                    this.perPallet = p.perPallet
                    this.applyProduct(p.code)
                }
            })
        },
        scanBatch() {
            uni.scanCode({
                success: (res) => {
                    const v = (res.result || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)
                    this.batchNo = v
                    this.resolveProductOptions()
                },
                fail: () => {}
            })
        },
        applyProduct(code) {
            const p = productCatalog.find(x => x.code === code)
            this.weightProduct = code || '未选择产品'
            if (!p) { this.calculateMaterial(); return }
            if (!this.perCase) this.perCase = p.perCase
            if (!this.perPallet) this.perPallet = p.perPallet
            this.calculateMaterial()
        },
        calculateMaterial() {
            const r = computeMaterial({
                buckets: this.buckets,
                zeroCount: this.zeroCount,
                perCase: this.perCase,
                perPallet: this.perPallet,
                sampleCount: this.sampleCount,
                labelExtra: this.labelExtra,
                securityExtra: this.securityExtra,
                currentPallet: this.currentPallet
            })
            this.currentPallet = r.currentPallet
            this.totalPallets = r.totalPallets
            this.inboundCount = r.inboundCount
            this.innerIssued = r.innerIssued
            this.bucketCount = r.bucketCount
            this.caseCount = r.caseCount
            this.caseCountText = r.caseCountText
            this.palletCode = r.palletCode
            this.palletPage = r.palletPage
            this.palletRange = r.palletRange
            this.zeroBoxInfo = r.zeroBoxInfo
            // 保留手动填写的领用/损耗/退回（按包材名匹配），重建 materials 不清空
            const prevMat = {}
            this.materials.forEach(m => { prevMat[m.name] = { issued: m.issued, loss: m.loss, returned: m.returned } })
            this.materials = r.materials.map(m => {
                const p = prevMat[m.name] || {}
                return { name: m.name, used: m.used, issued: p.issued || '', loss: p.loss || '', returned: p.returned || '' }
            })
            this.lastCalculation = {
                buckets: r.buckets, bucketCount: r.bucketCount, caseCount: r.caseCount,
                zeroBottleCount: r.zeroBottleCount, bottleCount: r.bottleCount,
                sampleCount: r.sampleCount, innerPackageIssued: r.innerPackageIssued,
                totalPallets: r.totalPallets, markCount: r.markCount,
                labelExtra: r.labelExtra, securityExtra: r.securityExtra,
                materials: r.materialUsed
            }
            this.updateWeightRange()
            return r.totalPallets
        },
        updateWeightRange() {
            this.weightRange = computeWeightRange(this.bottleWeight, this.boxNetWeight)
        },
        goPallet(act) {
            if (act === 'first') this.currentPallet = 1
            else if (act === 'prev') this.currentPallet = Math.max(1, this.currentPallet - 1)
            else if (act === 'next') this.currentPallet = Math.min(this.totalPallets, this.currentPallet + 1)
            else if (act === 'last') this.currentPallet = this.totalPallets
            this.calculateMaterial()
        },
        // ===== 安卓：从帆软获取每桶件数 =====
        async fetchFromFr() {
            if (!this.batchValid) {
                uni.showToast({ title: '请先输入有效批号', icon: 'none' })
                return
            }
            this.fetching = true
            this.frMsg = '正在连接帆软…'
            try {
                const result = await fetchBatchBucketQtys(this.batchNo)
                this.bucketKeys.forEach(k => {
                    this.buckets[k] = (result[k] || 0) ? String(result[k]) : ''
                })
            this.calculateMaterial()
            this.frMsg = '已获取每桶件数'
            uni.showToast({ title: '帆软数据已填入', icon: 'success' })
            // 手机即桥：手动获取后同步到云端，供小程序读取（失败不阻断）
            try {
                const bk = {}
                this.bucketKeys.forEach(k => { bk[k] = Number(this.buckets[k]) || 0 })
                await upsertBatchBuckets(this.batchNo, bk)
                this.frMsg = '已获取并同步云端'
            } catch (ce) {
                console.warn('[fr-fetch] 云端同步失败（可稍后用云端按钮重试）：', ce && ce.message)
            }
        } catch (e) {
                this.frMsg = '获取失败：' + (e.message || e)
                uni.showModal({ title: '获取失败', content: (e.message || '') + '\n请确认已在内网登录帆软，或手动录入。', showCancel: false })
            } finally {
                this.fetching = false
            }
        },
        // ===== 云端（uniCloud）：App / 微信小程序通用 =====
        async fetchFromCloud() {
            if (!this.batchValid) {
                uni.showToast({ title: '请先输入有效批号', icon: 'none' })
                return
            }
            this.cloudFetching = true
            this.cloudMsg = '正在查询云端…'
            try {
                const result = await fetchBatchBucketsFromCloud(this.batchNo)
                this.bucketKeys.forEach(k => {
                    this.buckets[k] = (result[k] || 0) ? String(result[k]) : ''
                })
                this.calculateMaterial()
                this.cloudMsg = '云端数据已填入'
                uni.showToast({ title: '云端数据已填入', icon: 'success' })
            } catch (e) {
                this.cloudMsg = '获取失败：' + (e.message || e)
                uni.showModal({
                    title: '获取失败',
                    content: (e.message || '') + '\n请确认：① 项目已关联 uniCloud 服务空间；② 该批号已通过同步桥推送到云端。',
                    showCancel: false
                })
            } finally {
                this.cloudFetching = false
            }
        },
        // ===== 草稿持久化 =====
        async save() {
            if (!this.batchValid) { uni.showToast({ title: '批号须为11位且含字母与数字', icon: 'none' }); return }
            if (!/^\d{10}$/.test(this.productCode)) { uni.showToast({ title: '请选择10位产品编码', icon: 'none' }); return }
            this.calculateMaterial()
            const statusVal = this.batchStatus
            const materialInputs = {}
            this.materials.forEach(m => {
                materialInputs[m.name] = {
                    issued: Number(m.issued) || 0,
                    loss: Number(m.loss) || 0,
                    returned: Number(m.returned) || 0
                }
            })
            const rec = {
                batchNo: this.batchNo, productCode: this.productCode, batchStatus: statusVal,
                bottlePerCase: Number(this.perCase) || 0, casePerPallet: Number(this.perPallet) || 0,
                bottleWeight: Number(this.bottleWeight) || 0, bottleWeightMin: Number(this.bottleWeightMin) || 0,
                boxNetWeight: Number(this.boxNetWeight) || 0, boxNetWeightMin: Number(this.boxNetWeightMin) || 0,
                materialInputs,
                ...this.lastCalculation, savedAt: new Date().toISOString()
            }
            const results = uni.getStorageSync(STORE_RESULTS) || {}
            results[this.batchNo] = rec
            uni.setStorageSync(STORE_RESULTS, results)
            uni.setStorageSync(STORE_DRAFT, rec)
            let hist = uni.getStorageSync(STORE_HISTORY) || []
            hist = [this.batchNo, ...hist.filter(x => x !== this.batchNo)].slice(0, 20)
            uni.setStorageSync(STORE_HISTORY, hist)
            // 保存并上云（多端共享）
            try {
                await saveProductionRecord(rec)
                // 同时写草稿到云（设备私有），失败不阻断
                try {
                    await saveDraftRecord(getDeviceId(), rec)
                } catch (de) {
                    console.warn('[draft] 草稿上云失败：', de && de.message)
                }
                uni.showToast({ title: '已保存并同步云端', icon: 'success' })
            } catch (e) {
                console.warn('[cloud] 生产记录同步失败：', e && e.message)
                uni.showToast({ title: '已保存（云端同步失败）', icon: 'none' })
            }
        },
        async openHistory() {
            this.historyShow = true
            // 30 秒内有缓存直接用，避免反复开关重复请求
            if (this._historyCacheAt && Date.now() - this._historyCacheAt < 30000) {
                return
            }
            this.historyKeyword = ''
            this.historyLoaded = 0
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
                const page = await listProductionRecords(50, this.historyLoaded)
                const remote = (page || []).map(r => r.batchNo).filter(Boolean)
                const merged = [...this.historyList, ...remote.filter(x => this.historyList.indexOf(x) < 0)]
                this.historyList = merged
                this.historyLoaded += (page || []).length
                if ((page || []).length < 50) this.historyDone = true
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
        },
        // 分享进入：按批号从云端拉取该批数据并载入
        loadSharedBatch(batchNo) {
            fetchProductionRecord(batchNo).then(rec => {
                if (rec) {
                    this.loadRecord(rec)
                    uni.showToast({ title: '已加载云端数据', icon: 'success' })
                } else {
                    uni.showToast({ title: '该批号暂无云端数据', icon: 'none' })
                }
            }).catch(() => {
                uni.showToast({ title: '加载云端数据失败', icon: 'none' })
            })
        },
        loadRecord(rec) {
            this.batchNo = rec.batchNo
            this.productCode = rec.productCode
            this.weightProduct = rec.productCode || '未选择产品'
            this.perCase = rec.bottlePerCase || ''
            this.perPallet = rec.casePerPallet || ''
            this.zeroCount = rec.zeroBottleCount || ''
            this.sampleCount = rec.sampleCount || ''
            this.labelExtra = rec.labelExtra || ''
            this.securityExtra = rec.securityExtra || ''
            this.bottleWeight = rec.bottleWeight || ''
            this.bottleWeightMin = rec.bottleWeightMin || ''
            this.boxNetWeight = rec.boxNetWeight || ''
            this.boxNetWeightMin = rec.boxNetWeightMin || ''
            this.batchStatus = rec.batchStatus || 'incomplete'
            if (rec.buckets) {
                this.bucketKeys.forEach((k, i) => { this.buckets[k] = rec.buckets[k] != null ? String(rec.buckets[k]) : '' })
            }
            this.currentPallet = 1
            this.calculateMaterial()
            // 回填手动填写的包材领用/损耗/退回
            if (rec.materialInputs) {
                this.materials.forEach(m => {
                    const inp = rec.materialInputs[m.name]
                    if (inp) {
                        m.issued = inp.issued != null ? String(inp.issued) : ''
                        m.loss = inp.loss != null ? String(inp.loss) : ''
                        m.returned = inp.returned != null ? String(inp.returned) : ''
                    }
                })
            }
        },
        clearAll() {
            this.bucketKeys.forEach(k => { this.buckets[k] = '' })
            this.zeroCount = ''; this.sampleCount = ''; this.labelExtra = ''; this.securityExtra = ''
            this.bottleWeight = ''; this.bottleWeightMin = ''; this.boxNetWeight = ''; this.boxNetWeightMin = ''
            this.batchNo = ''; this.productCode = ''
            this.perCase = ''; this.perPallet = ''; this.weightProduct = '未选择产品'
            this.batchStatus = 'incomplete'; this.currentPallet = 1
            this.calculateMaterial()
            uni.showToast({ title: '已清空', icon: 'none' })
        },
        // ===== 卡片折叠与排序 =====
        toggleCard(key) {
            if (this._noTap) return
            const c = this.cardList.find(x => x.key === key)
            if (c) { c.collapsed = !c.collapsed; this.saveCardLayout() }
        },
        moveCard(idx, dir) {
            const j = idx + dir
            if (j < 0 || j >= this.cardList.length) return
            const arr = this.cardList
            const t = arr[idx]
            arr.splice(idx, 1)
            arr.splice(j, 0, t)
            this.saveCardLayout()
        },
        saveCardLayout() {
            const order = this.cardList.map(c => c.key)
            const collapsed = {}
            this.cardList.forEach(c => { collapsed[c.key] = c.collapsed })
            uni.setStorageSync(STORE_LAYOUT, { order, collapsed })
        },
        loadCardLayout() {
            const saved = uni.getStorageSync(STORE_LAYOUT)
            if (!saved || !Array.isArray(saved.order) || !saved.order.length) return
            const ord = saved.order.filter(k => CARD_KEYS.includes(k))
            CARD_KEYS.forEach(k => { if (!ord.includes(k)) ord.push(k) })
            const map = {}
            ord.forEach((k, i) => { map[k] = i })
            this.cardList = CARD_DEFS.map(c => ({
                key: c.key, title: c.title, collapsed: !!(saved.collapsed && saved.collapsed[c.key])
            }))
            // 重新排列 cardList 顺序
            this.cardList.sort((a, b) => (map[a.key] - map[b.key]))
        },
        // ===== 长按拖拽排序 =====
        measureTops() {
            uni.createSelectorQuery().in(this).selectAll('.card').boundingClientRect().exec(res => {
                const rects = (res && res[0]) || []
                this.cardTops = rects.map(r => r.top)
                if (rects[0]) this.cardH = rects[0].height
            })
        },
        startDrag(key, idx, e) {
            this.dragKey = key
            this.dragIndex = idx
            this.dragMode = true
            this.lockPageScroll()
            this.$nextTick(() => {
                this.measureTops()
                // 记录起始手指 Y（优先用事件触点）
                const t = e && e.touches && e.touches[0]
                if (t && typeof t.clientY === 'number') this.dragY = t.clientY
            })
        },
        // 锁定页面滚动（App/H5：非被动 touchmove + preventDefault；微信端由 page-meta 处理）
        lockPageScroll() {
            // #ifdef APP-PLUS || H5
            if (typeof document === 'undefined') return
            if (!this._preventScroll) {
                this._preventScroll = (ev) => { ev.preventDefault() }
                document.addEventListener('touchmove', this._preventScroll, { passive: false })
            }
            // #endif
        },
        unlockPageScroll() {
            // #ifdef APP-PLUS || H5
            if (typeof document === 'undefined') return
            if (this._preventScroll) {
                document.removeEventListener('touchmove', this._preventScroll)
                this._preventScroll = null
            }
            // #endif
        },
        onDragMove(e) {
            if (!this.dragMode) return
            if (e && e.preventDefault) e.preventDefault()
            const t = e.touches[0]
            if (!t) return
            this.dragY = t.clientY
            if (!this.cardTops.length) return
            let target = this.cardTops.findIndex(top => this.dragY < top + this.cardH / 2)
            if (target < 0) target = this.cardTops.length - 1
            if (target !== this.dragIndex && target >= 0) {
                const arr = this.cardList
                const item = arr[this.dragIndex]
                arr.splice(this.dragIndex, 1)
                arr.splice(target, 0, item)
                this.dragIndex = target
                this.$nextTick(() => this.measureTops())
            }
        },
        endDrag() {
            if (!this.dragMode) return
            this.dragMode = false
            this.dragKey = ''
            this.dragIndex = -1
            this.cardTops = []
            this.unlockPageScroll()
            this.saveCardLayout()
            // 松手后短暂屏蔽点击，避免长按松手误触折叠
            this._noTap = true
            setTimeout(() => { this._noTap = false }, 350)
        },
        goUserManage() {
            uni.navigateTo({ url: '/pages/user-manage/user-manage' })
        }
    }
}
</script>

<style scoped>
.page { padding: 16rpx; }
.admin-strip { display: flex; align-items: center; gap: 10rpx; background: #E6F4F1; border-radius: 12rpx; padding: 14rpx 18rpx; margin-bottom: 14rpx; }
.as-ico { font-size: 26rpx; color: #008577; }
.as-txt { flex: 1; font-size: 26rpx; font-weight: 700; color: #008577; }
.as-arrow { font-size: 30rpx; color: #008577; }
.share-fab { position: fixed; right: 24rpx; bottom: 48rpx; z-index: 50; background: #008577; color: #fff; font-size: 26rpx; border-radius: 999rpx; padding: 0 34rpx; height: 72rpx; line-height: 72rpx; box-shadow: 0 6rpx 20rpx rgba(0,133,119,0.35); }
.card { background: #fff; border-radius: 16rpx; padding: 0; margin-bottom: 14rpx; box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.03); overflow: hidden; }
.card-head { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 18rpx; background: #F4F7F6; }
.card-head-left { display: flex; align-items: center; gap: 12rpx; flex: 1; min-width: 0; }
.card-title { font-size: 28rpx; font-weight: 700; color: #1f2622; }
.card-tools { display: flex; align-items: center; gap: 6rpx; }
.sort-btn { width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center; font-size: 26rpx; color: #008577; background: #fff; border-radius: 8rpx; }
.drag-hint { width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center; font-size: 30rpx; color: #b6c2bd; }
.collapse-btn { width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center; font-size: 24rpx; color: #77827D; background: #fff; border-radius: 8rpx; }
.card-body { padding: 18rpx; }
.card.dragging { box-shadow: 0 10rpx 30rpx rgba(0,133,119,0.28); opacity: 0.92; transform: scale(1.01); }
.drag-overlay { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 200; }

.cmd-grid { display: flex; justify-content: space-between; align-items: flex-end; }
.cmd-info { flex: 1; }
.inline-field { display: flex; align-items: center; margin-bottom: 10rpx; background: #F4F7F6; border-radius: 12rpx; padding: 0 14rpx; height: 64rpx; }
.lbl { font-size: 22rpx; color: #77827D; width: 110rpx; flex-shrink: 0; }
.inp { flex: 1; height: 64rpx; font-size: 26rpx; background: transparent; }
.scan-input { display: flex; align-items: center; flex: 1; }
.scan-mini { width: 56rpx; height: 56rpx; margin-left: 8rpx; border-radius: 10rpx; background: #008577; color: #fff; font-size: 28rpx; line-height: 56rpx; padding: 0; }
.cmd-actions { display: flex; flex-direction: column; margin-left: 12rpx; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 18rpx; height: 64rpx; line-height: 64rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; }
.btn.danger { background: #FBEAE9; color: #D9534F; }
.btn[disabled] { opacity: 0.5; }

.fr-bar { margin-top: 12rpx; display: flex; align-items: center; flex-wrap: wrap; }
.fr-btn { background: #E6F4F1; color: #008577; height: 60rpx; line-height: 60rpx; }
.cloud-btn { background: #E8F0FE; color: #2F5597; height: 60rpx; line-height: 60rpx; }
.fr-hint { font-size: 20rpx; color: #77827D; margin-left: 12rpx; }

.section-line { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12rpx; }
.h2 { font-size: 28rpx; font-weight: 700; padding-left: 12rpx; border-left: 6rpx solid #008577; }
.hint { font-size: 20rpx; color: #77827D; }
.chip { font-size: 20rpx; color: #008577; background: #E6F4F1; padding: 2rpx 12rpx; border-radius: 999rpx; }
.chip.active { background: #008577; color: #fff; }

.bucket-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10rpx; }
.bucket-tail { margin-top: 12rpx; }
.bucket { display: flex; flex-direction: column; }
.blbl { font-size: 20rpx; color: #77827D; margin-bottom: 4rpx; }
.binp { height: 60rpx; border: 1rpx solid #E3E8E5; border-radius: 10rpx; font-size: 26rpx; text-align: center; background: #fff; }
.binp[disabled] { background: #F2F4F3; color: #bbb; }

.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; }
.data-cell { background: #F7F9F8; border-radius: 12rpx; padding: 10rpx; min-height: 88rpx; display: flex; flex-direction: column; justify-content: center; }
.dlbl { font-size: 20rpx; color: #77827D; }
.dinp { margin-top: 4rpx; font-size: 26rpx; background: transparent; height: 40rpx; }
.dval { margin-top: 4rpx; font-size: 28rpx; font-weight: 700; color: #008577; }
.picker { margin-top: 4rpx; font-size: 24rpx; background: #fff; border: 1rpx solid #E3E8E5; border-radius: 8rpx; padding: 6rpx 10rpx; }
.sync-line { font-size: 20rpx; color: #77827D; margin: 12rpx 0; }
.seg-row { display: flex; align-items: center; gap: 12rpx; margin: 6rpx 0 12rpx; }
.seg { flex: 1; display: flex; background: #F2F4F3; border-radius: 12rpx; padding: 4rpx; gap: 4rpx; }
.seg-item { flex: 1; text-align: center; font-size: 24rpx; color: #77827D; padding: 14rpx 0; border-radius: 10rpx; }
.seg-item.active { background: #008577; color: #fff; font-weight: 700; }
.btn-row { display: flex; gap: 12rpx; }
.btn-row .btn { flex: 1; }

.material-addons { display: flex; gap: 12rpx; margin-bottom: 10rpx; }
.material-table { border: 1rpx solid #E3E8E5; border-radius: 12rpx; overflow: hidden; }
.material-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr; align-items: center; padding: 8rpx 10rpx; border-bottom: 1rpx solid #F0F3F1; font-size: 22rpx; }
.material-row:last-child { border-bottom: none; }
.material-row.head { background: #F4F7F6; color: #77827D; font-size: 20rpx; }
.mname { font-weight: 600; }
.minp { height: 48rpx; border: 1rpx solid #E3E8E5; border-radius: 8rpx; font-size: 22rpx; text-align: center; background: #fff; margin: 0 2rpx; }
.minp.used { background: #F2F4F3; color: #555; }
.pad { display: block; margin-top: 10rpx; }

.inline-field.pager-summary { display: flex; align-items: center; gap: 12rpx; margin-bottom: 10rpx; }
.strong { font-weight: 700; font-size: 26rpx; }
.pager-actions { display: flex; gap: 10rpx; }
.pager-actions .btn { flex: 1; }

.sheet-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: flex-end; z-index: 99; }
.sheet { background: #fff; width: 100%; border-radius: 24rpx 24rpx 0 0; padding: 24rpx; max-height: 70vh; }
.sheet-head { display: flex; justify-content: space-between; font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.count { font-size: 22rpx; color: #77827D; }
.sheet-body { max-height: 50vh; }
.hist-item { display: flex; justify-content: space-between; padding: 20rpx 8rpx; border-bottom: 1rpx solid #F0F3F1; }
.code { font-size: 26rpx; font-weight: 600; }
.arrow { color: #008577; font-size: 24rpx; }
.empty { text-align: center; color: #bbb; padding: 40rpx; font-size: 24rpx; }
.search-bar { padding: 4rpx 0 12rpx; }
.search-inp { height: 60rpx; background: #F2F4F3; border-radius: 12rpx; padding: 0 20rpx; font-size: 24rpx; }
.load-more { text-align: center; color: #008577; font-size: 24rpx; padding: 20rpx 0; }
.back { color: #008577; font-size: 28rpx; font-weight: 700; }
.ver-item { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 8rpx; border-bottom: 1rpx solid #F0F3F1; }
.ver-item:last-child { border-bottom: none; }
.ver-info { display: flex; align-items: center; gap: 12rpx; flex: 1; min-width: 0; }
.ver-tag { font-size: 20rpx; color: #77827D; background: #F2F4F3; padding: 2rpx 10rpx; border-radius: 999rpx; flex-shrink: 0; }
.ver-tag.latest { background: #008577; color: #fff; }
.ver-time { font-size: 22rpx; color: #77827D; flex-shrink: 0; }
.ver-desc { font-size: 22rpx; color: #1f2622; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ver-actions { display: flex; gap: 8rpx; flex-shrink: 0; }
.btn.mini { height: 48rpx; line-height: 48rpx; font-size: 22rpx; padding: 0 16rpx; border-radius: 10rpx; }
.btn.mini.danger { background: #FBEAE9; color: #D9534F; }
</style>
