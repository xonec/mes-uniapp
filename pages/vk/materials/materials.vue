<template>
    <page-meta :disable-scroll="dragMode"></page-meta>
    <view class="page" @touchmove="onDragMove" @touchend="endDrag" @touchcancel="endDrag">
        <view class="work-header"><view><text class="fw-subtitle">先确认批号和订单，再填写每桶件数。</text></view>
            <!-- #ifdef MP-WEIXIN -->
            <button class="fw-button secondary share-button" open-type="share">分享</button>
            <!-- #endif -->
        </view>
        <view class="work-entries"><button @tap="goOrderSheet"><text class="entry-label">指令单录入</text><text class="entry-note">拍照识别订单 ›</text></button><button @tap="goArchive"><text class="entry-label">产品档案</text><text class="entry-note">查看规格和物料 ›</text></button></view>
        <view v-if="orderMessage" class="fw-notice" :class="{ warning: orderLookupFailed || (linkedOrder && linkedOrder.orderStatus !== 'confirmed') }">{{ orderMessage }}</view>
        <view v-if="linkedOrder" class="order-overview"><view class="order-overview-head"><text>订单 {{ linkedOrder.orderNo }} · V{{ linkedOrder.version || 1 }}</text><text class="fw-badge" :class="{ warning: linkedOrder.orderStatus !== 'confirmed' }">{{ linkedOrder.orderStatus === 'confirmed' ? '正式订单' : '订单草稿' }}</text></view><text class="order-product">{{ linkedOrder.productName }} · {{ linkedOrder.productCode }}</text><view class="order-tags"><text>{{ linkedOrder.customerName || '未填写客户' }}</text><text :class="{ pending: palletPending }">{{ palletPending ? '上托待确认 · 暂不计算托数' : perPallet + ' 箱 / 托' }}</text></view></view>
        <view v-if="lastSavedBatch === batchNo && saveMessage" class="fw-notice" :class="{ warning: saveFailed }">上次保存：{{ saveMessage }}</view>
        <view v-for="(c, idx) in cardList" :key="c.key" class="card" :class="{ dragging: dragMode && c.key === dragKey }">
            <view class="card-head" @tap="toggleCard(c.key)" @longpress="startDrag(c.key, idx, $event)">
                <view class="card-head-left">
                    <text class="card-title">{{ c.title }}</text>
                    <text v-if="c.key==='buckets'" class="hint">按 A → J 顺序录入</text>
                    <text v-else-if="c.key==='prod'" class="hint">自动结果只读</text>
                    <text v-else-if="c.key==='material'" class="chip">实用量自动</text>
                    <text v-else-if="c.key==='weight'" class="chip" :class="{active: !!weightProduct}">{{ weightProduct || '未选择产品' }}</text>
                    <text v-else-if="c.key==='pallet'" class="chip">{{ palletPage }}</text>
                </view>
                <view class="card-tools">
                    <view class="drag-hint"><uni-icons type="bars" size="16" color="#5F6A65"></uni-icons></view>
                    <view class="collapse-btn" @tap.stop="toggleCard(c.key)"><uni-icons :type="c.collapsed ? 'right' : 'bottom'" size="12" color="#008577"></uni-icons></view>
                </view>
            </view>
            <view v-show="!c.collapsed" class="card-body">
                <batch-card v-if="c.key==='batch'"
                    :product-code="productCode" :batch-no="batchNo" :batch-valid="batchValid"
                    :product-locked="!!linkedOrder" :order-loading="orderLookupPending" :disabled="savingRecord"
                    :is-android="isAndroid" :cloud-fetching="cloudFetching" :fetching="fetching"
                    :fr-msg="frMsg" :cloud-msg="cloudMsg"
                    @update:productCode="onProductInput" @update:batchNo="onBatchInput"
                    @scan="scanBatch" @smart-fill="smartFill" @choose-product="chooseProduct"
                    @fetch-cloud="fetchFromCloud" @fetch-fr="fetchFromFr" />
                <buckets-card :disabled="savingRecord" v-else-if="c.key==='buckets'"
                    :legacy-layout="isAndroid"
                    :buckets.sync="buckets" :bucket-keys="bucketKeys"
                    :zero-count.sync="zeroCount" :per-case.sync="perCase" :per-pallet.sync="perPallet"
                    :pallet-locked="!!linkedOrder"
                    @change="calculateMaterial" />
                <prod-card v-else-if="c.key==='prod'"
                    :legacy-layout="isAndroid"
                    :inbound-count="inboundCount" :sample-count.sync="sampleCount"
                    :inner-issued="innerIssued" :bucket-count="bucketCount"
                    :case-count-text="caseCountText" :pallet-code="palletCode"
                    :batch-status.sync="batchStatus" :hide-actions="true" :saving="savingRecord"
                    @change="calculateMaterial" @save="save" @history="goHistory" @clear="clearAll" />
                <material-card :disabled="savingRecord" v-else-if="c.key==='material'"
                    :label-extra.sync="labelExtra" :security-extra.sync="securityExtra"
                    :materials="materials" @change="calculateMaterial" />
                <weight-card :disabled="savingRecord" v-else-if="c.key==='weight'"
                    :box-net-weight.sync="boxNetWeight" :bottle-weight.sync="bottleWeight"
                    :weight-range="weightRange" :bottle-weight-min.sync="bottleWeightMin"
                    :box-net-weight-min.sync="boxNetWeightMin"
                    @change="updateWeightRange" />
                <pallet-card :disabled="savingRecord" v-else-if="c.key==='pallet'"
                    :pallet-range="palletRange" :zero-box-info="zeroBoxInfo"
                    :current-pallet="currentPallet" :total-pallets="totalPallets"
                    :pending="palletPending"
                    @go="goPallet" />
            </view>
        </view>
        <view v-if="!keyboardVisible" class="fw-footer"><view class="fw-footer-note">{{ orderLookupPending ? '正在查询订单，请稍候。' : orderLookupFailed ? '订单查询失败，请重试后保存。' : orderNotReady ? '请先确认并启用本次订单。' : cloudFetching || fetching ? '正在获取每桶件数，请稍候。' : palletPending ? '上托未确认，当前不计算托数。' : !batchValid ? '请输入完整批号后保存。' : '保存当前生产记录，并同步云端。' }}</view><view class="fw-actions"><button class="fw-button secondary" :disabled="savingRecord" @tap="goHistory">查看历史</button><button class="fw-button primary" :disabled="savingRecord || !batchValid || orderLookupPending || orderLookupFailed || orderNotReady || cloudFetching || fetching" @tap="save">{{ savingRecord ? '保存中…' : '保存生产记录' }}</button></view></view>
    </view>
</template>

<script>
import { productCatalog, batchIsValid, productMatches, parseBatchCode } from '@/utils/product-data.js'
import { isAppAndroid, fetchBatchBucketQtys } from '@/utils/fr-fetch.js'
import { fetchBatchBucketsFromCloud, upsertBatchBuckets } from '@/utils/cloud-db.js'
import { getDeviceId } from '@/utils/device.js'
import { saveProductionRecord, fetchProductionRecord, saveDraftRecord, getDraftRecord } from '@/utils/production-db.js'
import { getUser, checkLogin } from '@/utils/auth.js'
import { computeMaterial, computeWeightRange } from '@/utils/calc.js'
import { callCloud } from '@/utils/vk-records-api.js'
import { openPage, pageUrl } from '@/utils/vk-migration.js'
import { STORE_RESULTS, STORE_HISTORY, STORE_DRAFT, STORE_SHARE_BATCH, STORE_LOAD_RECORD, STORE_LAST_BATCH } from '@/utils/storage-keys.js'
import CardLayoutMixin from '@/mixins/card-layout.js'
import BatchCard from '@/components/batch-card/batch-card.vue'
import BucketsCard from '@/components/buckets-card/buckets-card.vue'
import ProdCard from '@/components/prod-card/prod-card.vue'
import MaterialCard from '@/components/material-card/material-card.vue'
import WeightCard from '@/components/weight-card/weight-card.vue'
import PalletCard from '@/components/pallet-card/pallet-card.vue'

const bucketKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

export default {
    components: { BatchCard, BucketsCard, ProdCard, MaterialCard, WeightCard, PalletCard },
    mixins: [CardLayoutMixin],
    data() {
        const buckets = {}
        bucketKeys.forEach(k => { buckets[k] = '' })
        return {
            keyboardVisible: false, savingRecord: false, saveMessage: '', saveFailed: false, lastSavedBatch: '',
            isAndroid: false,
            adminChecked: false,
            isAdminVerified: false,
            bucketKeys,
            productCode: '',
            linkedOrder: null,
            orderMessage: '',
            orderLookupPending: false,
            orderLookupFailed: false,
            orderLookupRequest: 0,
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
            batchStatus: 'incomplete'
            // 历史 / 版本 与 卡片布局 / 拖拽 状态由 mixins 提供
        }
    },
    computed: {
        orderNotReady() { return !!(this.linkedOrder && (this.linkedOrder.orderStatus !== 'confirmed' || this.linkedOrder.enabled === false)) },
        palletPending() { return this.orderLookupPending || this.orderLookupFailed || !!(this.linkedOrder && (!this.linkedOrder.pallet || this.linkedOrder.pallet.status !== 'confirmed')); },
        batchValid() {
            return batchIsValid(this.batchNo)
        },
        isAdmin() {
            // 服务端复核结果优先；未复核完成时回退本地判断（避免闪烁）
            if (this.adminChecked) return this.isAdminVerified
            const u = getUser()
            return !!(u && u.role && u.role.indexOf('admin') >= 0)
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
        this.keyboardHandler = event => { this.keyboardVisible = Number(event.height) > 0 }
        if (uni.onKeyboardHeightChange) uni.onKeyboardHeightChange(this.keyboardHandler)
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
        if (uni.getStorageSync('mes:operation-calculation')) return
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
            getDraftRecord(getDeviceId(), draft.batchNo, callCloud).then(remote => {
                if (remote && this.batchNo === draft.batchNo) this.loadRecord(remote)
            }).catch(() => {})
        } else {
            this.calculateMaterial()
        }
    },
    onShow() {
        const operation = uni.getStorageSync('mes:operation-calculation')
        if (operation && operation.jobId) { this.loadOperationCalculation(operation); return }
        // 历史页「载入」切回：读取暂存记录回填表单
        const rec = uni.getStorageSync(STORE_LOAD_RECORD)
        if (rec && rec.batchNo) {
            uni.removeStorageSync(STORE_LOAD_RECORD)
            this.loadRecord(rec)
            uni.showToast({ title: '已载入', icon: 'none' })
        }
    },
    onUnload() { if (uni.offKeyboardHeightChange && this.keyboardHandler) uni.offKeyboardHeightChange(this.keyboardHandler) },
    onShareAppMessage() {
        const title = this.batchValid ? `批号 ${this.batchNo} · 包材计算` : 'MES生产助手 - 包材计算'
        return {
            title,
            path: pageUrl('materials', this.batchValid ? { batchNo: this.batchNo } : {})
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
        /** 从云端复核工单采用版本，再载入计算；本地传递数据不作为订单凭据。 */
        async loadOperationCalculation(context) {
            if (this.orderLookupPending) return
            this.orderLookupPending = true; this.orderMessage = '正在复核工单及采用的订单版本…'
            const request = ++this.orderLookupRequest
            try {
                const result = await callCloud('production-operations', 'getJob', { id: context.jobId })
                const job = result.job
                if (!job || !job.orderSnapshot || job.orderSnapshot.batchNo !== job.batchNo) throw new Error('工单采用的订单凭据不完整')
                const rec = await fetchProductionRecord(job.batchNo, callCloud)
                if (request !== this.orderLookupRequest) return
                this.loadRecord({ ...(rec || {}), batchNo: job.batchNo, productCode: job.productCode, orderSnapshot: job.orderSnapshot, buckets: rec && rec.buckets || {} })
                const spec = String(job.orderSnapshot.packSpec || '').match(/(\d+)\s*(?:瓶|罐|袋|盒|包|支|个)\s*[/／]\s*(?:箱|件)/)
                this.perCase = spec ? Number(spec[1]) : ''
                this.perPallet = job.orderSnapshot.pallet && job.orderSnapshot.pallet.status === 'confirmed' ? job.orderSnapshot.pallet.casesPerPallet : ''
                this.weightProduct = job.productName
                this.orderMessage = '工单 ' + job.processName + ' · 采用订单 ' + job.orderNo + ' V' + job.orderVersion + (rec ? ' · 已载入该批原有计算数据' : '') + (!this.perPallet ? ' · 上托待补充' : '')
                this.calculateMaterial(); uni.removeStorageSync('mes:operation-calculation')
            } catch (error) { if (request === this.orderLookupRequest) { this.orderLookupFailed = true; this.orderMessage = '工单计算载入失败：' + error.message; uni.removeStorageSync('mes:operation-calculation') } }
            finally { if (request === this.orderLookupRequest) this.orderLookupPending = false }
        },
        onBatchInput(v) {
            v = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
            this.batchNo = v
            this.resolveProductOptions()
        },
        onProductInput(v) {
            if (this.linkedOrder) { uni.showToast({ title: '本批产品由已关联订单确定', icon: 'none' }); return }
            v = (v || '').replace(/\D/g, '').slice(0, 10)
            this.productCode = v
            this.applyProduct(v)
        },
        async resolveProductOptions(preserveManual = false) {
            const request = ++this.orderLookupRequest
            const batchNo = this.batchNo
            this.linkedOrder = null; this.orderMessage = ''; this.orderLookupFailed = false
            if (!batchIsValid(batchNo)) { this.orderLookupPending = false; return }
            if (!preserveManual) { this.productCode = ''; this.perCase = ''; this.perPallet = ''; this.weightProduct = '未选择产品' }
            this.orderLookupPending = true; this.calculateMaterial()
            try {
                const order = await callCloud('production-orders', 'getByBatch', { batchNo })
                if (this.batchNo !== batchNo || this.orderLookupRequest !== request) return
                if (order) {
                    this.linkedOrder = order; this.productCode = order.productCode; this.weightProduct = order.productName
                    const perCase = String(order.packSpec || '').match(/(\d+)\s*(?:瓶|罐|袋|盒|包|支|个)\s*[/／]\s*(?:箱|件)/)
                    this.perCase = perCase ? Number(perCase[1]) : ''
                    this.perPallet = order.pallet && order.pallet.status === 'confirmed' ? order.pallet.casesPerPallet : ''
                    this.orderMessage = '订单 ' + order.orderNo + ' · V' + (order.version || 1) + ' · ' + (order.customerName || '客户待选择') + (order.orderStatus !== 'confirmed' ? ' · 订单尚未确认' : '') + (!order.pallet || order.pallet.status !== 'confirmed' ? ' · 上托待补充，暂不计算托数' : ' · 采用本单上托要求')
                    return
                }
            } catch (error) {
                if (this.batchNo === batchNo && this.orderLookupRequest === request) { this.orderLookupFailed = true; this.orderMessage = '订单查询失败，暂不自动匹配产品和上托：' + error.message }
                return
            } finally { if (this.batchNo === batchNo && this.orderLookupRequest === request) { this.orderLookupPending = false; this.calculateMaterial() } }
            if (this.batchNo === batchNo && this.orderLookupRequest === request) this.orderMessage = '未找到本批订单。请先导入指令单，或手工选择并核对产品和上托要求。'
        },
        smartFill() { this.resolveProductOptions(true) },
        chooseProduct() {
            if (this.linkedOrder || this.orderLookupPending || this.orderLookupFailed) { uni.showToast({ title: this.linkedOrder ? '本批产品由已关联订单确定' : '请先完成订单查询', icon: 'none' }); return }
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
        // 从扫码/识别结果解析批号并应用（高置信直填，低置信先让用户确认）
        applyBatchCode(raw) {
            const parsed = parseBatchCode(raw)
            if (!parsed.code) {
                uni.showModal({ title: '没识别到内容', content: '原始内容：' + (parsed.raw || '（空）'), showCancel: false })
                return
            }
            const use = (code) => {
                this.batchNo = code
                this.resolveProductOptions()
                // 记住最近一次成功录入，扫码页会提示，防止重复扫错
                try { uni.setStorageSync(STORE_LAST_BATCH, code) } catch (e) { /* ignore */ }
            }
            if (parsed.matched) { use(parsed.code); return }
            // 低置信：提示原文与解析结果，用户可确认填入或重新扫
            const looksLikeBatch = batchIsValid(parsed.code) && parsed.cleaned === parsed.code
            uni.showModal({
                title: looksLikeBatch ? '批号前缀未匹配' : '这不像批号',
                content: '扫描内容：' + (parsed.raw || '（空）') + '\n解析为：' + parsed.code + '\n（批号格式：11 位字母数字，B 单保留末尾 B；按完整批号关联订单）',
                confirmText: '仍要填入',
                cancelText: '重新扫',
                success: (m) => { if (m.confirm) use(parsed.code) }
            })
        },
        scanBatch() {
            // #ifdef APP-PLUS
            // 自定义扫码页：实时取景 + 相册识别（ML Kit）+ 手电筒，仿微信扫码
            uni.navigateTo({
                url: '/pages/scan/scan',
                events: {
                    scanResult: (raw) => this.applyBatchCode(raw)
                },
                fail: (err) => {
                    uni.showModal({ title: '打开扫码页失败', content: (err && err.errMsg) || JSON.stringify(err), showCancel: false })
                }
            })
            // #endif
            // #ifndef APP-PLUS
            uni.scanCode({
                scanType: ['barCode', 'qrCode'],
                success: (res) => {
                    this.applyBatchCode(res.result)
                },
                fail: () => {}
            })
            // #endif
        },
        applyProduct(code) {
            if (this.linkedOrder || this.orderLookupPending || this.orderLookupFailed) { this.calculateMaterial(); return }
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
                palletPending: this.palletPending,
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
                palletPending: this.palletPending,
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
            if (this.palletPending) return
            if (act === 'first') this.currentPallet = 1
            else if (act === 'prev') this.currentPallet = Math.max(1, this.currentPallet - 1)
            else if (act === 'next') this.currentPallet = Math.min(this.totalPallets, this.currentPallet + 1)
            else if (act === 'last') this.currentPallet = this.totalPallets
            this.calculateMaterial()
        },
        // ===== 从帆软获取每桶件数：取数 → 预览 → 确认插入 =====
        async fetchFromFr() {
            if (!this.batchValid) {
                uni.showToast({ title: '请先输入有效批号', icon: 'none' })
                return
            }
            this.fetching = true
            this.frMsg = '正在连接帆软…'
            try {
                const result = await fetchBatchBucketQtys(this.batchNo)
                // 预览结果，让用户选择是否插入到分桶件数
                const lines = this.bucketKeys
                    .filter(k => (result[k] || 0) > 0)
                    .map(k => `${k} 桶：${result[k]} 件`)
                if (!lines.length) {
                    this.frMsg = '报表无数据'
                    uni.showToast({ title: '报表无数据', icon: 'none' })
                    return
                }
                this.frMsg = '已获取，请确认是否插入'
                uni.showModal({
                    title: '获取到各桶件数',
                    content: lines.join('\n'),
                    confirmText: '插入',
                    cancelText: '取消',
                    success: (res) => {
                        if (res.confirm) this.applyBuckets(result)
                        else this.frMsg = '已取消插入'
                    }
                })
            } catch (e) {
                this.frMsg = '获取失败：' + (e.message || e)
                uni.showModal({ title: '获取失败', content: (e.message || '') + '\n请确认能访问帆软报表服务器。', showCancel: false })
            } finally {
                this.fetching = false
            }
        },
        // 确认插入：填入各桶件数 → 重算 → 同步云端
        async applyBuckets(result) {
            this.bucketKeys.forEach(k => {
                this.buckets[k] = (result[k] || 0) ? String(result[k]) : ''
            })
            this.calculateMaterial()
            this.frMsg = '已插入各桶件数'
            uni.showToast({ title: '已插入', icon: 'success' })
            // 手机即桥：同步到云端，供其他端读取（失败不阻断）
            try {
                const bk = {}
                this.bucketKeys.forEach(k => { bk[k] = Number(this.buckets[k]) || 0 })
                await upsertBatchBuckets(this.batchNo, bk, {}, callCloud)
                this.frMsg = '已插入并同步云端'
            } catch (ce) {
                console.warn('[fr-fetch] 云端同步失败（可稍后用云端按钮重试）：', ce && ce.message)
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
                const result = await fetchBatchBucketsFromCloud(this.batchNo, callCloud)
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
            if (this.savingRecord || this.cloudFetching || this.fetching) return
            if (!this.batchValid) { uni.showToast({ title: '批号须为11位字母数字或追加B单后缀', icon: 'none' }); return }
            if (this.orderLookupPending || this.orderLookupFailed) { uni.showToast({ title: '请先完成订单查询后保存', icon: 'none' }); return }
            if (this.linkedOrder && (this.linkedOrder.orderStatus !== 'confirmed' || this.linkedOrder.enabled === false)) { uni.showToast({ title: '请先在后台确认并启用本单', icon: 'none' }); return }
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
                orderNo: this.linkedOrder ? this.linkedOrder.orderNo : '', orderVersion: this.linkedOrder ? Number(this.linkedOrder.version) || 1 : null,
                bottlePerCase: Number(this.perCase) || 0, casePerPallet: Number(this.perPallet) || 0,
                bottleWeight: Number(this.bottleWeight) || 0, bottleWeightMin: Number(this.bottleWeightMin) || 0,
                boxNetWeight: Number(this.boxNetWeight) || 0, boxNetWeightMin: Number(this.boxNetWeightMin) || 0,
                materialInputs,
                ...this.lastCalculation, savedAt: new Date().toISOString()
            }
            if (this.linkedOrder) rec.orderSnapshot = { ...this.linkedOrder, packagingSnapshot: undefined }
            const results = uni.getStorageSync(STORE_RESULTS) || {}
            results[this.batchNo] = rec
            uni.setStorageSync(STORE_RESULTS, results)
            uni.setStorageSync(STORE_DRAFT, rec)
            let hist = uni.getStorageSync(STORE_HISTORY) || []
            hist = [this.batchNo, ...hist.filter(x => x !== this.batchNo)].slice(0, 20)
            uni.setStorageSync(STORE_HISTORY, hist)
            // 保存并上云（多端共享）
            this.savingRecord = true; this.saveMessage = ''; this.lastSavedBatch = rec.batchNo
            try {
                await saveProductionRecord(rec, callCloud)
                // 同时写草稿到云（设备私有），失败不阻断
                try {
                    await saveDraftRecord(getDeviceId(), rec, callCloud)
                } catch (de) {
                    console.warn('[draft] 草稿上云失败：', de && de.message)
                }
                this.saveMessage = '已保存并同步云端'; this.saveFailed = false
                uni.showToast({ title: '已保存并同步云端', icon: 'success' })
            } catch (e) {
                console.warn('[cloud] 生产记录同步失败：', e && e.message)
                this.saveMessage = '已保存在本机，云端同步失败，请重试保存。'; this.saveFailed = true
                uni.showToast({ title: '已存本机，云端同步失败', icon: 'none' })
            } finally { this.savingRecord = false }
        },
        // ===== 历史记录 / 版本回滚 ===== 由 mixins/history.js 提供
        // 分享进入：按批号从云端拉取该批数据并载入
        loadSharedBatch(batchNo) {
            fetchProductionRecord(batchNo, callCloud).then(rec => {
                if (this.batchNo !== batchNo) return
                if (rec) {
                    this.loadRecord(rec)
                    uni.showToast({ title: '已加载云端数据', icon: 'success' })
                } else {
                    this.resolveProductOptions()
                    uni.showToast({ title: '该批号暂无云端数据', icon: 'none' })
                }
            }).catch(() => {
                uni.showToast({ title: '加载云端数据失败', icon: 'none' })
            })
        },
        loadRecord(rec) {
            this.orderLookupRequest++
            this.linkedOrder = rec.orderSnapshot || null
            this.orderLookupPending = false; this.orderLookupFailed = false
            this.orderMessage = this.linkedOrder ? '载入历史生产记录，采用订单 ' + this.linkedOrder.orderNo + ' · V' + (this.linkedOrder.version || 1) : ''
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
            if (!rec.orderSnapshot) this.resolveProductOptions(true)
        },
        clearAll() {
            if (this.savingRecord) return
            this.saveMessage = ''; this.lastSavedBatch = ''
            this.orderLookupRequest++
            this.bucketKeys.forEach(k => { this.buckets[k] = '' })
            this.zeroCount = ''; this.sampleCount = ''; this.labelExtra = ''; this.securityExtra = ''
            this.bottleWeight = ''; this.bottleWeightMin = ''; this.boxNetWeight = ''; this.boxNetWeightMin = ''
            this.batchNo = ''; this.productCode = ''
            this.linkedOrder = null; this.orderMessage = ''; this.orderLookupPending = false; this.orderLookupFailed = false
            this.perCase = ''; this.perPallet = ''; this.weightProduct = '未选择产品'
            this.batchStatus = 'incomplete'; this.currentPallet = 1
            this.calculateMaterial()
            uni.showToast({ title: '已清空', icon: 'none' })
        },
        // ===== 卡片折叠 / 排序 / 拖拽 ===== 由 mixins/card-layout.js 提供
        goOrderSheet() { openPage('order-sheet', { purpose: 'order' }) },
        goArchive() { openPage('archive') },
        goHistory() { openPage('history') }
    }
}
</script>

<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.page { box-sizing: border-box; padding: 20rpx 20rpx calc(176rpx + env(safe-area-inset-bottom)); color: $ink; }
.work-header { display: flex; align-items: center; justify-content: space-between;  margin: 0 0 20rpx; }.work-header .fw-subtitle { font-size: 24rpx; line-height: 1.5; margin-top: 0; }.share-button { font-size: 24rpx; padding: 0 16rpx; flex-shrink: 0; margin-top: 4rpx; }
.work-entries { display: flex;  margin-bottom: 20rpx; }.work-entries button { flex: 1; min-width: 0; text-align: left; padding: 20rpx; margin: 0; background: $surface; border-radius: 24rpx; line-height: 1.5; }.work-entries button::after { border: 0; }.entry-label { display: block; font-size: 28rpx; font-weight: 600; color: $primary; }.entry-note { display: block; font-size: 24rpx; color: $muted; margin-top: 8rpx; }
.order-overview { background: $surface; padding: 20rpx; border-radius: 24rpx; margin-bottom: 20rpx; border-left: 6.4rpx solid $primary; }.order-overview-head { display: flex; align-items: center; justify-content: space-between;  font-size: 28rpx; font-weight: 600; }.order-product { display: block; font-size: 28rpx; line-height: 1.6; margin-top: 12rpx; }.order-tags { display: flex; flex-wrap: wrap;  font-size: 24rpx; margin-top: 12rpx; color: $muted; }.order-tags .pending { color: $warning; }
.card { background: $surface; border-radius: 27.2rpx; margin-bottom: 18rpx; overflow: hidden; }.card-head { display: flex; align-items: center; justify-content: space-between; padding: 18rpx 20rpx; border-bottom: 1px solid $line; }.card-head-left { display: flex; flex-wrap: wrap; align-items: center;  flex: 1; min-width: 0; }.card-title { font-size: 32rpx; font-weight: 700; }.card-tools { display: flex; align-items: center;  margin-left: 6rpx; }.drag-hint { display: flex; align-items: center; padding: 6rpx; }.collapse-btn { min-width: 72rpx; min-height: 72rpx; display: flex; align-items: center; justify-content: center; background: $canvas; border-radius: 11.2rpx; }.card-body { padding: 20rpx; }.card.dragging { opacity: .92; transform: scale(1.01); border: 1px solid $primary; }
.hint { font-size: 22rpx; color: $muted; }.chip { font-size: 22rpx; color: $primary; background: $primary-soft; padding: 4rpx 10rpx; border-radius: 9.6rpx; }.chip.active { background: $primary; color: $surface; }.fw-footer .fw-button.secondary { flex: 0 0 30%; padding: 0 6rpx; }

.work-header .share-button { margin-left: 16rpx; }
.work-entries button + button { margin-left: 14rpx; }
.order-overview-head .fw-badge { margin-left: 12rpx; }
.order-tags > text { margin-right: 12rpx; }
.card-head-left .hint, .card-head-left .chip { margin-left: 12rpx; }
.card-tools > view + view { margin-left: 8rpx; }

</style>
