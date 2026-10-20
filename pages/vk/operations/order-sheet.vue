<template>
    <view class="fw-page entry-page">
        <StepBar :steps="steps" :current="stepIndex" @select="onStepSelect" />
        <view class="fw-header">
            <text class="fw-subtitle">{{ purpose === 'bom' ? '以产品编码建档，保留固定规格和材料清单。' : '同一份指令单解析后录入生产订单；产品尚未建档时可一并建立产品资料。' }}</text>
        </view>
        <view v-if="uiStage !== 'recognize' && (error || savedMessage || conflicted)" id="entry-feedback">
            <view v-if="error" class="fw-notice error">{{ error }}</view>
            <button v-if="conflicted" class="fw-button secondary" :disabled="busy" @tap="reloadLatest">重新加载最新记录</button>
            <view v-if="savedMessage" class="fw-notice">{{ savedMessage }}</view>
        </view>

        <!-- 第一步：拍照 / 相册 -->
        <template v-if="uiStage === 'photos'">
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">指令单照片</text><text class="fw-badge muted">{{ images.length }} / 6 张</text></view>
                <view v-if="!images.length" class="photo-empty">
                    <text class="photo-symbol">▤</text><text class="photo-empty-title">拍下首页，再补充材料清单</text>
                    <text class="fw-note">同一份指令单可选多页，产品编码要清晰。</text>
                </view>
                <view v-else class="photos">
                    <view v-for="(photo, index) in imageItems" :key="photo.key" class="photo-item">
                        <image :src="photo.path" mode="aspectFill" @tap="preview(index)" />
                        <text class="photo-page">{{ index === 0 ? '首页' : '第 ' + (index + 1) + ' 页' }}</text>
                        <button class="photo-remove" :disabled="busy" @tap="removePhoto(index)" :aria-label="'删除第' + (index + 1) + '张照片'">×</button>
                        <button v-if="index > 0" class="photo-first" :disabled="busy" @tap="makeFirst(index)">设为首页</button>
                    </view>
                </view>
                <view class="photo-actions">
                    <button class="fw-button photo-btn" :disabled="busy || images.length >= 6" @tap="choose(['camera'])">拍照</button>
                    <button class="fw-button photo-btn" :disabled="busy || images.length >= 6" @tap="choose(['album'])">相册选图</button>
                </view>
                <view v-if="images.length" class="photo-clear-row"><text class="photo-clear" @tap="clearPhotos">清空全部照片</text></view>
                <view v-if="images.length" class="flow-line">
                    <text class="fw-note">{{ flowMode === 'model-first' ? '大模型优先，失败自动用免费 OCR 兜底' : '免费 OCR 先提取编码，再由大模型补全' }}</text>
                    <text class="fw-badge" :class="flowMode === 'model-first' ? 'tone-primary' : 'tone-neutral'">{{ flowMode === 'model-first' ? '大模型优先' : 'OCR 优先' }}</text>
                </view>
                <view v-if="form" class="draft-line">
                    <text class="fw-note">已有核对内容</text>
                    <text class="draft-link" @tap="uiStage = 'review'">继续核对 ›</text>
                </view>
                <button v-if="!form && !recordKey" class="manual-entry" :disabled="busy" @tap="startManual">没有照片？手动录入或载入档案 ›</button>
                <view v-if="draftRestored" class="draft-line"><text class="draft-link" @tap="clearDraftAndRestart">清除草稿，重新开始</text></view>
            </view>
        </template>

        <!-- 第二步：识别进展 / 失败出口 / 编码确认 -->
        <template v-else-if="uiStage === 'recognize'">
            <view class="fw-card recognize-card">
                <template v-if="recognizing">
                    <view class="recognize-head"><text class="recognize-title">正在识别指令单</text><text class="recognize-elapsed">已用时 {{ elapsedLabel }}</text></view>
                    <text class="fw-note">{{ recognizeStageText }}</text>
                    <view class="recognize-track"><view class="recognize-bar" /></view>
                    <text class="fw-note">识别在后台进行，可继续等待或取消回到照片步；取消不会丢失已选照片。</text>
                </template>
                <template v-else-if="needsProductCodeConfirmation">
                    <view class="recognize-head"><text class="recognize-title">未能确认产品编码</text><text class="fw-badge tone-warning">需确认</text></view>
                    <text class="fw-note">可核对首页后填写 10 位编码继续，或用原图完整识别。</text>
                    <view class="fw-field"><text class="fw-label">确认产品编码</text><input class="fw-input" v-model="confirmedProductCode" :disabled="busy || !!recordKey" type="number" maxlength="10" placeholder="10 位数字" /></view>
                </template>
                <template v-else-if="error">
                    <view class="recognize-head"><text class="recognize-title">识别未完成</text><text class="fw-badge tone-danger">失败</text></view>
                    <text class="recognize-error">{{ error }}</text>
                    <text v-if="leaseCountdown > 0" class="recognize-lease">{{ leaseCountdown }} 秒后自动重试一次；相同照片仍在服务端处理，请勿重复上传。</text>
                    <text class="fw-note">{{ leaseCountdown > 0 ? '倒计时结束后会自动重试，请等待结果，不要重复点识别。' : '可用免费 OCR 兜底重试，或改为手动录入（照片和订单信息不会丢）。' }}</text>
                </template>
                <template v-else-if="form">
                    <view class="recognize-head"><text class="recognize-title">识别完成</text><text class="fw-badge tone-primary">可核对</text></view>
                    <text class="fw-note">{{ recognitionMessage || '识别结果已填入核对表单，请逐项核对后保存。' }}</text>
                </template>
                <template v-else>
                    <view class="recognize-head"><text class="recognize-title">准备识别</text></view>
                    <text class="fw-note">已选 {{ images.length }} 张照片，点击下方「开始识别」。</text>
                </template>
            </view>
        </template>

        <!-- 第三步：核对保存 -->
        <template v-else-if="form">
            <view class="review-summary fw-card">
                <view><text class="fw-heading-title">核对录入内容</text><text class="fw-subtitle">{{ images.length ? images.length + ' 张本次识别照片' : form.sourceDocumentId ? '已关联原始单据' : '手动录入' }}</text></view>
                <button class="fw-button secondary" :disabled="busy" @tap="uiStage = 'photos'">{{ images.length ? '查看照片' : '使用照片' }}</button>
            </view>
            <view v-if="recognitionMessage" class="fw-notice">{{ recognitionMessage }}</view>
            <view v-if="fallbackInfo" class="fw-card fallback-card">
                <view class="fw-heading"><text class="fw-heading-title">免费 OCR 兜底结果</text><text class="fw-badge muted">未自动保存</text></view>
                <text class="fw-note">大模型未成功；已用免费 OCR（引擎 {{ fallbackInfo.engine }}）提取文本，请核对或手动录入。解析出的编码/批号已预填。</text>
                <view class="fallback-text" :class="{ expanded: fallbackExpanded }">{{ fallbackExpanded ? fallbackInfo.text : fallbackTextPreview }}</view>
                <view class="fw-actions">
                    <button class="fw-button secondary" :disabled="busy" @tap="fallbackExpanded = !fallbackExpanded">{{ fallbackExpanded ? '收起全文' : '展开全文' }}</button>
                    <button class="fw-button secondary" :disabled="busy" @tap="startManual">改为手动录入</button>
                </view>
            </view>
            <view v-if="uncertainText" class="fw-notice warning">待核对：{{ uncertainText }}</view>
            <view v-if="form.enabled === false" class="fw-notice warning">此记录已停用。修改后仍保留停用状态，启用请联系管理员。</view>
            <view v-if="purpose === 'order'" class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">01 · 订单信息</text><text class="fw-badge muted">本次生产</text></view>
                <view class="fw-field-grid">
                    <view class="fw-field" :class="{ warn: isUncertain('orderNo') }"><text class="fw-label">订单号 *</text><input class="fw-input" v-model="form.orderNo" :disabled="busy" type="number" maxlength="12" placeholder="4～12 位数字" /></view>
                    <view class="fw-field" :class="{ warn: isUncertain('batchNo') }"><text class="fw-label">生产批号 *</text><input class="fw-input" v-model="form.batchNo" :disabled="busy" maxlength="12" placeholder="如 APDD26X1006" /></view>
                </view>
                <view class="fw-field" :class="{ warn: isUncertain('plannedQty') }"><text class="fw-label">计划产量（件 / 箱）*</text><input class="fw-input" v-model="form.plannedQty" :disabled="busy" type="digit" placeholder="保留单据上的数量" /></view>
                <view class="fw-field"><text class="fw-label">取样说明</text><textarea class="fw-textarea" v-model="form.sampleCount" :disabled="busy" maxlength="2000" auto-height placeholder="保留完整取样要求" /></view>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">{{ purpose === 'order' ? '02' : '01' }} · 产品信息</text><text v-if="productArchiveExists" class="fw-badge">已有档案</text></view>
                <view class="code-row">
                    <view class="fw-field" :class="{ warn: isUncertain('productCode') }"><text class="fw-label">产品编码 *</text><input class="fw-input" v-model="form.productCode" :disabled="busy || !!recordKey" type="number" maxlength="10" placeholder="10 位数字" /></view>
                    <button class="fw-button secondary" :disabled="busy || !/^\d{10}$/.test(String(form.productCode || '').trim())" @tap="loadArchive">载入档案</button>
                </view>
                <view class="fw-field" :class="{ warn: isUncertain('productName') }"><text class="fw-label">产品名称 *</text><textarea class="fw-textarea" v-model="form.productName" :disabled="busy" maxlength="120" auto-height placeholder="含口味等完整名称" /></view>
                <view class="fw-field" :class="{ warn: isUncertain('packSpec') }"><text class="fw-label">固定包装规格 *</text><textarea class="fw-textarea" v-model="form.packSpec" :disabled="busy" maxlength="500" auto-height placeholder="如 1.8kg/瓶 × 4瓶/箱" /></view>
                <text class="fw-note">{{ purpose === 'order' ? '载入档案仅载入名称和固定规格，客户材料在下方选择。' : '载入档案会载入已保存的产品和材料清单。' }}</text>
            </view>
            <view v-if="purpose === 'order'" class="fw-card"><PackagingSelection :value="form" :record-key="formEpoch" :call="callCloud" :disabled="busy" @loading="selectionLoading = $event" @input="form = $event" /></view>
            <view class="fw-card"><MaterialListEditor :value="form.materials" :disabled="busy" @input="form.materials = $event" /></view>
            <view v-if="purpose === 'order'" class="fw-card"><PalletEditor :value="form.pallet" :disabled="busy" @input="form.pallet = $event" /></view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">保存设置</text><text v-if="observedVersion > 0" class="fw-badge muted">当前 V{{ observedVersion }}</text></view>
                <view v-if="purpose === 'order'" class="status-options">
                    <button :class="{ active: form.orderStatus === 'draft' }" :disabled="busy" @tap="form.orderStatus = 'draft'"><text>草稿</text><text class="status-help">继续补充核对</text></button>
                    <button :class="{ active: form.orderStatus === 'confirmed' }" :disabled="busy" @tap="form.orderStatus = 'confirmed'"><text>正式确认</text><text class="status-help">上托要求可后补</text></button>
                </view>
                <view class="fw-field"><text class="fw-label">{{ observedVersion > 0 ? '修改原因 *' : '录入说明（可选）' }}</text><textarea class="fw-textarea" v-model="form.changeReason" :disabled="busy" maxlength="1000" auto-height placeholder="填写调整原因或单据依据" /></view>
                <text class="fw-note">{{ form.sourceDocumentId ? '原图和识别来源随记录保存，可在后台追溯。' : '当前为手动录入；修改会保留版本记录。' }}</text>
                <view v-if="purpose === 'order' && !productArchiveExists" class="archive-option">
                    <text class="fw-note">此产品尚未建档，可使用核对后的材料建立产品物料档案。</text>
                    <button class="fw-button secondary" :disabled="busy || needsProductCodeConfirmation" @tap="createProductArchive">建立产品物料档案</button>
                </view>
                <view v-if="productArchiveMessage" class="recognition-note">{{ productArchiveMessage }}</view>
            </view>
        </template>

        <ActionBar v-if="!keyboardVisible" :primary="actionPrimary" :secondary="actionSecondary" :note="footerNote" :primary-disabled="actionPrimaryDisabled" :secondary-disabled="actionSecondaryDisabled" @primary="onActionPrimary" @secondary="onActionSecondary" />
    </view>
</template>
<script>
import { callCloud } from '@/utils/vk-order-api.js'
import { decodeParam } from '@/utils/vk-migration.js'
import { chooseOcrImages, ocrImageIdentity } from '@/utils/ocr-image.js'
import { recognizeOcr, archiveOcrSource, loadOcrFlowMode } from '@/utils/ocr-client.js'
import { fetchMaterialsByCode, upsertProductMaterials } from '@/utils/product-materials-db.js'
import { batchIsValid } from '@/utils/shared/batch.js'
import MaterialListEditor from '@/components/material-list-editor/MaterialListEditor.vue'
import PackagingSelection from '@/components/traceability/PackagingSelection.vue'
import PalletEditor from '@/components/traceability/PalletEditor.vue'
import StepBar from '@/components/ui/StepBar.vue'
import ActionBar from '@/components/ui/ActionBar.vue'
import { getUser } from '@/utils/auth.js'
const FIELD_NAMES = { orderNo: '订单号', batchNo: '批号', productCode: '产品编码', productName: '产品名称', packSpec: '包装规格', plannedQty: '计划产量', sampleCount: '取样数', materials: '包装材料清单' }
export default {
    components: { MaterialListEditor, PackagingSelection, PalletEditor, StepBar, ActionBar },
    data() {
        return {
            steps: ['拍照', '识别', '核对保存'],
            uiStage: 'photos',
            keyboardVisible: false,
            selectionLoading: false,
            formEpoch: 0,
            purpose: 'bom',
            recordKey: '',
            choosing: false,
            recognizing: false,
            saving: false,
            conflicted: false,
            images: [],
            lastRecognizedImages: [],
            needsProductCodeConfirmation: false,
            canUseModelFallback: false,
            confirmedProductCode: '',
            recognitionMessage: '',
            formSource: 'manual',
            flowMode: '',
            fallbackInfo: null,
            fallbackExpanded: false,
            form: null,
            error: '',
            savedMessage: '',
            observedKey: '',
            observedVersion: null,
            archivedProductCode: '',
            productArchiveMessage: '',
            recognizeEpoch: 0,
            leaseCountdown: 0,
            leaseTimer: null,
            leaseAutoRetried: false,
            recognizeStartedAt: 0,
            recognizeElapsed: 0,
            recognizeTimer: null,
            draftTimer: null,
            draftRestored: false
        }
    },
    computed: {
        /** 非 H5 平台的 :key 不支持表达式，这里给每张照片预计算稳定 key。 */
        imageItems() { return (this.images || []).map((photo, index) => ({ ...photo, key: photo.originalHash || photo.path || ('photo-' + index) })) },
        fallbackTextPreview() {
            const text = String((this.fallbackInfo && this.fallbackInfo.text) || '')
            return text.length > 160 ? text.slice(0, 160) + '…' : text
        },
        busy() { return this.choosing || this.recognizing || this.saving || this.selectionLoading },
        stepIndex() { return this.uiStage === 'review' ? 2 : this.uiStage === 'recognize' ? 1 : 0 },
        elapsedLabel() { const seconds = Math.max(0, Math.floor(this.recognizeElapsed)); return seconds < 60 ? seconds + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒' },
        recognizeStageText() {
            const seconds = Math.floor(this.recognizeElapsed)
            if (seconds < 3) return '正在上传照片并检查识别缓存…'
            if (seconds < 20) return '大模型正在解析指令单，失败会自动用免费 OCR 兜底…'
            return '识别耗时较长，仍在后台处理，可继续等待或取消。'
        },
        footerNote() {
            if (this.selectionLoading) return '正在载入客户方案，请稍候。'
            if (this.recognizing) return '识别完成后请逐项核对，再保存。'
            if (this.uiStage === 'photos') return this.images.length ? '照片会先上传原图并调用识别；结果需人工核对。' : '先拍照或从相册选择指令单照片。'
            if (this.uiStage === 'recognize') {
                if (this.leaseCountdown > 0) return this.leaseCountdown + ' 秒后自动重试；相同照片仍在服务端处理，请勿重复上传。'
                return this.needsProductCodeConfirmation ? '确认编码后继续识别，或改用原图完整识别。' : '识别失败不会丢失照片，可兜底重试或手动录入。'
            }
            if (this.purpose === 'order' && (!this.form.pallet || this.form.pallet.status !== 'confirmed')) return '上托要求待补充；保存后暂不计算托数。'
            return '请核对产品编码、包装规格和每一项材料。'
        },
        actionPrimary() {
            if (this.uiStage === 'review') return this.saving ? '保存中…' : this.purpose === 'order' ? (this.form.orderStatus === 'confirmed' ? '确认并保存订单' : '保存订单草稿') : '核对完成，保存档案'
            if (this.uiStage === 'recognize') {
                if (this.recognizing) return '继续等待'
                if (this.needsProductCodeConfirmation) return '确认编码并继续'
                if (this.error) {
                    if (this.leaseCountdown > 0) return this.leaseCountdown + ' 秒后自动重试'
                    if (this.isLeaseError(this.error)) return '立即重试'
                    return '用 OCR 兜底重试'
                }
                if (this.form) return '去核对'
                return '开始识别'
            }
            if (this.photosRecognized && this.form) return '去核对'
            return '开始识别'
        },
        actionSecondary() {
            if (this.uiStage === 'review') return '上一步'
            if (this.uiStage === 'recognize') {
                if (this.recognizing) return '取消识别'
                if (this.needsProductCodeConfirmation && this.canUseModelFallback) return '用原图完整识别'
                if (this.error) return '手动录入'
                if (this.form) return '重新识别'
                return ''
            }
            return this.form ? '查看核对内容' : ''
        },
        actionPrimaryDisabled() {
            if (this.uiStage === 'review') return this.busy || this.needsProductCodeConfirmation
            if (this.uiStage === 'recognize') {
                if (this.recognizing) return false
                if (this.needsProductCodeConfirmation) return this.busy || !/^\d{10}$/.test(String(this.confirmedProductCode || '').trim())
                if (this.error) return this.busy || this.leaseCountdown > 0 || !this.images.length
                if (this.form) return false
                return this.busy || !this.images.length
            }
            return this.busy || !this.images.length || this.needsProductCodeConfirmation
        },
        actionSecondaryDisabled() {
            if (this.uiStage === 'recognize' && this.recognizing) return false
            return this.busy
        },
        photosRecognized() { return this.lastRecognizedImages.length > 0 && this.images.length === this.lastRecognizedImages.length && this.images.every((image, index) => ocrImageIdentity(image) === this.lastRecognizedImages[index]) },
        productArchiveExists() { return !!this.archivedProductCode && this.archivedProductCode === String(this.form && this.form.productCode || '').trim() },
        uncertainText() { return ((this.form && this.form.uncertain) || []).map(key => FIELD_NAMES[key] || '包装材料明细').join('、') }
    },
    watch: {
        error(message) { if (message) this.$nextTick(() => uni.pageScrollTo({ selector: '#entry-feedback', duration: 200 })) },
        'form.productCode'(code, previous) { if (String(code || '').trim() !== String(previous || '').trim()) this.productArchiveMessage = '' },
        form: { deep: true, handler() { this.queueDraft() } },
        images: { deep: true, handler() { this.queueDraft() } },
        uiStage() { this.queueDraft() }
    },
    async onLoad(options) {
        if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }
        this.keyboardHandler = event => { this.keyboardVisible = Number(event.height) > 0 }
        if (uni.onKeyboardHeightChange) uni.onKeyboardHeightChange(this.keyboardHandler)
        // 默认走完整的指令单流程；只有档案页「从照片录入产品」才显式传 purpose=bom
        this.purpose = decodeParam(options.purpose) === 'bom' ? 'bom' : 'order'
        this.syncNavTitle()
        // 识别流程由云端能力决定；取不到时按旧流程（screen-first）处理。
        loadOcrFlowMode(callCloud).then(mode => { this.flowMode = mode }).catch(() => {})
        if (options.productCode) {
            this.recordKey = decodeParam(options.productCode)
            this.syncNavTitle()
            this.choosing = true
            try {
                const record = await fetchMaterialsByCode(options.productCode, callCloud)
                if (!record) throw new Error('产品物料档案不存在，请返回档案页刷新')
                this.form = { ...record, uncertain: [] }; this.uiStage = 'review'; this.formEpoch++
                this.formSource = record.source || 'manual'
                this.archivedProductCode = record.productCode
                this.observedKey = record.productCode; this.observedVersion = Number(record.version) || 1
            } catch (error) { this.error = error.message }
            finally { this.choosing = false }
            return
        }
        if (this.restoreDraft()) uni.showToast({ title: '已恢复上次未完成的录入', icon: 'none' })
    },
    onHide() { this.saveDraft() },
    onUnload() {
        this.saveDraft()
        this.clearLeaseRetry()
        this.stopRecognizeTimer()
        if (uni.offKeyboardHeightChange && this.keyboardHandler) uni.offKeyboardHeightChange(this.keyboardHandler)
    },
    methods: {
        callCloud,
        isUncertain(key) { return ((this.form && this.form.uncertain) || []).includes(key) },
        /** 三步条回退：只允许退回已完成步骤，照片与识别结果保留。 */
        onStepSelect(index) {
            if (index >= this.stepIndex) return
            if (this.recognizing) this.cancelRecognition()
            this.uiStage = index === 0 ? 'photos' : 'recognize'
        },
        startRecognize() {
            if (this.busy) return
            if (!this.images.length) { this.error = '请先拍照或选择相册照片'; return }
            this.uiStage = 'recognize'
            return this.recognize()
        },
        /** 取消只停止等待并回照片步；后台结果通过 epoch 丢弃，不影响已选照片。 */
        cancelRecognition() {
            this.clearLeaseRetry()
            this.recognizeEpoch++
            this.recognizing = false
            this.stopRecognizeTimer()
            this.uiStage = 'photos'
            uni.showToast({ title: '已取消等待，可重新识别', icon: 'none' })
        },
        keepWaiting() { uni.showToast({ title: '识别仍在进行，请稍候', icon: 'none' }) },
        /** 服务端租约/正在处理类错误：倒计时 12 秒后自动重试一次，避免用户连点撞租约。 */
        isLeaseError(message) { return /(正在处理|正在识别|无需重复上传|稍后读取已有结果|租约|already exists)/i.test(String(message || '')) },
        clearLeaseRetry() {
            if (this.leaseTimer) { clearInterval(this.leaseTimer); this.leaseTimer = null }
            this.leaseCountdown = 0
        },
        scheduleLeaseRetry() {
            this.clearLeaseRetry()
            this.leaseAutoRetried = true
            this.leaseCountdown = 12
            this.leaseTimer = setInterval(() => {
                if (this.leaseCountdown > 0) this.leaseCountdown -= 1
                if (this.leaseCountdown > 0) return
                this.clearLeaseRetry()
                if (this.uiStage === 'recognize' && !this.recognizing && this.images.length) this.recognize('', false, true)
            }, 1000)
        },
        retryWithOcr() { if (!this.busy) return this.recognize() },
        startRecognizeTimer() {
            this.recognizeStartedAt = Date.now()
            this.recognizeElapsed = 0
            this.stopRecognizeTimer()
            this.recognizeTimer = setInterval(() => { this.recognizeElapsed = (Date.now() - this.recognizeStartedAt) / 1000 }, 1000)
        },
        stopRecognizeTimer() { if (this.recognizeTimer) { clearInterval(this.recognizeTimer); this.recognizeTimer = null } },
        onActionPrimary() {
            if (this.uiStage === 'review') return this.save()
            if (this.uiStage === 'recognize') {
                if (this.recognizing) return this.keepWaiting()
                if (this.needsProductCodeConfirmation) return this.confirmProductCode()
                if (this.error) return this.retryWithOcr()
                if (this.form) { this.uiStage = 'review'; return }
                return this.startRecognize()
            }
            if (this.photosRecognized && this.form) { this.uiStage = 'review'; return }
            return this.startRecognize()
        },
        onActionSecondary() {
            if (this.uiStage === 'review') { this.uiStage = 'photos'; return }
            if (this.uiStage === 'recognize') {
                if (this.recognizing) return this.cancelRecognition()
                if (this.needsProductCodeConfirmation && this.canUseModelFallback) return this.recognizeWithModel()
                if (this.error) return this.startManual()
                if (this.form) return this.recognize()
                return
            }
            if (this.form) this.uiStage = 'review'
        },
        resetRecognition() { this.lastRecognizedImages = []; this.needsProductCodeConfirmation = false; this.canUseModelFallback = false; this.confirmedProductCode = ''; this.recognitionMessage = ''; this.fallbackInfo = null; this.fallbackExpanded = false },
        /** 照片改变后整组清除旧表单及来源，防止新照片与旧识别结果混用。 */
        async replacePhotos(next) {
            if (this.form) {
                const yes = await new Promise(resolve => uni.showModal({ title: '更换识别照片', content: '更换、删除或调整照片后，需要重新识别。当前核对内容将被清除，已保存的档案不受影响。', confirmText: '重新识别', success: result => resolve(result.confirm), fail: () => resolve(false) }))
                if (!yes) return false
            }
            this.images = next; this.form = null; this.formEpoch++; this.selectionLoading = false
            this.resetRecognition(); this.uiStage = 'photos'; this.formSource = 'manual'
            this.observedKey = ''; this.observedVersion = null; this.archivedProductCode = ''; this.productArchiveMessage = ''; this.savedMessage = ''; this.error = ''; this.conflicted = false
            return true
        },
        clearPhotos() { if (!this.busy) return this.replacePhotos([]) },
        removePhoto(index) { if (!this.busy) return this.replacePhotos(this.images.filter((photo, i) => i !== index)) },
        makeFirst(index) { if (!this.busy && index > 0) return this.replacePhotos([this.images[index], ...this.images.filter((photo, i) => i !== index)]) },
        startManual() {
            if (this.busy) return
            this.clearLeaseRetry()
            this.images = []; this.resetRecognition()
            this.form = { productCode: '', productName: '', packSpec: '', materials: [], orderNo: '', batchNo: '', plannedQty: '', sampleCount: '', uncertain: [], enabled: true, orderStatus: 'draft', customerId: '', pallet: {}, changeReason: '' }
            this.uiStage = 'review'; this.formEpoch++; this.formSource = 'manual'; this.error = ''; this.savedMessage = ''; this.observedKey = ''; this.observedVersion = null; this.archivedProductCode = ''; this.productArchiveMessage = ''
        },
        /** 当前会话草稿：内存级（App globalData），返回/重进页面可恢复；不写数据库、不落云端。 */
        queueDraft() {
            if (this.draftTimer) clearTimeout(this.draftTimer)
            this.draftTimer = setTimeout(() => this.saveDraft(), 300)
        },
        saveDraft() {
            const app = getApp()
            if (!app) return
            if (!app.globalData) app.globalData = {}
            if (!this.form && !this.images.length && this.uiStage === 'photos') { app.globalData.mesEntryDraft = null; return }
            app.globalData.mesEntryDraft = {
                purpose: this.purpose,
                recordKey: this.recordKey,
                uiStage: this.uiStage,
                images: this.images,
                form: this.form,
                formSource: this.formSource,
                recognitionMessage: this.recognitionMessage,
                fallbackInfo: this.fallbackInfo,
                needsProductCodeConfirmation: this.needsProductCodeConfirmation,
                confirmedProductCode: this.confirmedProductCode,
                canUseModelFallback: this.canUseModelFallback,
                observedKey: this.observedKey,
                observedVersion: this.observedVersion,
                archivedProductCode: this.archivedProductCode,
                productArchiveMessage: this.productArchiveMessage,
                savedMessage: this.savedMessage,
                conflicted: this.conflicted
            }
        },
        restoreDraft() {
            const app = getApp()
            const draft = app && app.globalData && app.globalData.mesEntryDraft
            if (!draft || draft.recordKey || this.recordKey || draft.purpose !== this.purpose) return false
            this.images = draft.images || []
            this.form = draft.form || null
            this.uiStage = ['photos', 'recognize', 'review'].includes(draft.uiStage) ? draft.uiStage : 'photos'
            if (this.uiStage === 'recognize') this.uiStage = 'photos'
            if (this.uiStage === 'review' && !this.form) this.uiStage = 'photos'
            this.formSource = draft.formSource || 'manual'
            this.recognitionMessage = draft.recognitionMessage || ''
            this.fallbackInfo = draft.fallbackInfo || null
            this.needsProductCodeConfirmation = draft.needsProductCodeConfirmation === true
            this.confirmedProductCode = draft.confirmedProductCode || ''
            this.canUseModelFallback = draft.canUseModelFallback === true
            this.observedKey = draft.observedKey || ''
            this.observedVersion = draft.observedVersion
            this.archivedProductCode = draft.archivedProductCode || ''
            this.productArchiveMessage = draft.productArchiveMessage || ''
            this.savedMessage = draft.savedMessage || ''
            this.conflicted = draft.conflicted === true
            this.lastRecognizedImages = this.form && this.form.sourceDocumentId ? this.images.map(ocrImageIdentity) : []
            this.draftRestored = true
            return true
        },
        clearDraftAndRestart() {
            this.clearLeaseRetry()
            const app = getApp()
            if (app && app.globalData) app.globalData.mesEntryDraft = null
            this.images = []; this.form = null; this.formEpoch++; this.uiStage = 'photos'; this.formSource = 'manual'
            this.resetRecognition(); this.draftRestored = false; this.error = ''; this.savedMessage = ''; this.conflicted = false
            this.observedKey = ''; this.observedVersion = null; this.archivedProductCode = ''; this.productArchiveMessage = ''
        },
        async loadArchive() {
            if (this.busy) return
            this.saving = true; this.error = ''; this.savedMessage = ''
            try {
                const record = await fetchMaterialsByCode(String(this.form.productCode || '').trim(), callCloud)
                if (!record) throw new Error('未找到产品档案，可手动录入或重新拍照识别')
                this.form = { ...this.form, productCode: record.productCode, productName: record.productName, packSpec: record.packSpec, ...(this.purpose === 'bom' ? { materials: (record.materials || []).map(row => ({ ...row })), sourceDocumentId: record.sourceDocumentId || '', recognitionRunId: record.recognitionRunId || '' } : {}), uncertain: (this.form.uncertain || []).filter(key => !['productCode', 'productName', 'packSpec'].includes(key)) }
                if (this.purpose === 'bom') {
                    this.images = []; this.resetRecognition(); this.formEpoch++
                    this.observedKey = record.productCode; this.observedVersion = Number(record.version) || 1; this.form.enabled = record.enabled !== false
                }
                this.formSource = this.purpose === 'bom' ? record.source || 'manual' : 'manual'
                this.archivedProductCode = record.productCode; this.productArchiveMessage = ''
                this.recognitionMessage = record.enabled === false ? '已载入停用的产品档案，未调用大模型。请由管理员在后台启用产品。' : '已载入产品档案，未调用大模型。'
                this.needsProductCodeConfirmation = false
                this.canUseModelFallback = false
                uni.showToast({ title: '已载入产品档案', icon: 'none' })
            } catch (error) { this.error = error.message || '载入失败，请重试' }
            finally { this.saving = false }
        },
        async choose(sourceType) {
            if (this.busy) return
            this.choosing = true; this.error = ''
            try {
                const previous = this.images
                const next = await chooseOcrImages(sourceType, previous)
                if (next.length !== previous.length || next.some((image, index) => ocrImageIdentity(image) !== ocrImageIdentity(previous[index]))) await this.replacePhotos(next)
            }
            catch (error) { if (!/cancel/i.test(error.errMsg || error.message || '')) this.error = error.message || '读取图片失败，请重试' }
            finally { this.choosing = false }
        },
        preview(index) { uni.previewImage({ urls: this.images.map(image => image.path), current: this.images[index].path }) },
        async confirmProductCode() {
            if (this.busy || !this.needsProductCodeConfirmation) return
            const code = String(this.confirmedProductCode || '').trim()
            if (!/^\d{10}$/.test(code)) { this.error = '请确认 10 位纯数字产品编码'; return }
            if (this.recordKey && code !== this.recordKey) { this.error = '确认的产品编码与当前产品不一致，请在新增入口导入'; return }
            await this.recognize(code)
        },
        /** 未能确认编码时，主动用大模型识别；不要求用户先手填编码。 */
        async recognizeWithModel() {
            if (this.busy || !this.canUseModelFallback || !this.needsProductCodeConfirmation) return
            await this.recognize('', true)
        },
        async recognize(confirmedProductCode = '', useModel = false, autoRetry = false) {
            const code = String(confirmedProductCode || '').trim()
            if (!autoRetry) { this.leaseAutoRetried = false; this.clearLeaseRetry() }
            // model-first：用户不需要先确认编码，直接走「原图上传 → 模型 → 免费 OCR 兜底」。
            const modelFirst = this.flowMode === 'model-first'
            if (modelFirst && !code) useModel = true
            if (this.busy || (this.photosRecognized && !useModel) || !this.images.length || (this.needsProductCodeConfirmation && !code && !useModel)) return
            if (code && !/^\d{10}$/.test(code)) { this.error = '请确认 10 位纯数字产品编码'; return }
            if (useModel && this.form && !this.needsProductCodeConfirmation) {
                const yes = await new Promise(resolve => uni.showModal({ title: '完整识别原图', content: '将用本组照片的识别结果替换当前核对内容。已有结果会复用，没有结果时使用模型额度。', confirmText: '开始识别', success: result => resolve(result.confirm), fail: () => resolve(false) }))
                if (!yes) return
            }
            const epoch = ++this.recognizeEpoch
            if (this.uiStage !== 'recognize') this.uiStage = 'recognize'
            this.recognizing = true; this.error = ''; this.savedMessage = ''
            this.fallbackInfo = null; this.fallbackExpanded = false
            this.startRecognizeTimer()
            try {
                const result = await recognizeOcr(callCloud, this.images, this.purpose, { ...(useModel ? { useModel: true } : {}), ...(code ? { confirmedProductCode: code } : {}), ...(this.purpose === 'bom' && this.recordKey ? { expectedProductCode: this.recordKey } : {}) })
                if (epoch !== this.recognizeEpoch) return
                this.recognitionMessage = typeof result.message === 'string' ? result.message : ''
                this.fallbackInfo = result.fallback ? {
                    engine: result.fallback.engine,
                    text: String(result.fallback.text || ''),
                    textLength: Number(result.fallback.textLength) || 0,
                    parsed: result.fallback.parsed || {}
                } : null
                this.needsProductCodeConfirmation = result.needsProductCodeConfirmation === true
                this.canUseModelFallback = result.canUseModelFallback === true || (this.needsProductCodeConfirmation && ['ocrspace', 'local'].includes(result.recognitionSource))
                this.confirmedProductCode = this.recordKey || String(result.productCode || code || '').trim()
                if (this.recordKey && !this.needsProductCodeConfirmation && result.productCode !== this.recordKey) throw new Error('照片中的产品编码与当前产品不一致，请在新增入口导入')
                if (this.recordKey && this.needsProductCodeConfirmation) {
                    uni.showToast({ title: '请确认产品编码后继续', icon: 'none' })
                    return
                }
                this.form = { orderStatus: 'draft', customerId: this.form && this.form.customerId || '', customerName: this.form && this.form.customerName || '', pallet: {}, changeReason: '', ...result, materials: Array.isArray(result.materials) ? result.materials : [], enabled: result.enabled !== false }
                this.formEpoch++; this.uiStage = this.needsProductCodeConfirmation ? 'recognize' : 'review'
                this.archivedProductCode = result.archiveMatched ? result.productCode : ''; this.productArchiveMessage = ''
                this.observedKey = ''; this.observedVersion = null
                let existing = null
                if (this.purpose === 'bom' && result.archiveMatched) {
                    // 保存必须使用当前表单所展示的档案版本，不能再查询后把新版本套到旧内容上。
                    this.observedKey = result.productCode
                    this.observedVersion = Number(result.version) || 1
                } else existing = await this.observeExisting()
                if (epoch !== this.recognizeEpoch) return
                this.conflicted = false
                this.formSource = this.purpose === 'bom' && result.archiveMatched ? result.source || (existing && existing.source) || 'manual' : 'photo'
                this.lastRecognizedImages = !this.needsProductCodeConfirmation && (result.archiveMatched || result.modelUsed || result.recognitionSource === 'cache') ? this.images.map(ocrImageIdentity) : []
                const title = result.fallback ? '大模型未成功，已用免费 OCR 提取文本' : this.needsProductCodeConfirmation ? (this.canUseModelFallback ? '可使用大模型或确认编码' : '请确认产品编码后继续') : result.archiveMatched ? (result.modelUsed ? '本单完整识别完成' : '已载入产品信息，未调用大模型') : result.recognitionSource === 'cache' ? '已复用识别结果，请核对' : result.modelUsed ? '识别完成，请核对' : '识别完成，请核对'
                uni.showToast({ title, icon: 'none' })
            } catch (error) {
                if (epoch !== this.recognizeEpoch) return
                this.error = error.message || '识别失败，请重试'
                // 服务端仍持有同批照片的租约时只自动重试一次，其他错误保持人工出口。
                if (this.isLeaseError(this.error) && !this.leaseAutoRetried) this.scheduleLeaseRetry()
            } finally {
                if (epoch === this.recognizeEpoch) this.recognizing = false
                this.stopRecognizeTimer()
                if (epoch === this.recognizeEpoch && !this.leaseAutoRetried) this.clearLeaseRetry()
            }
        },
        /** 页面标题改由原生导航栏显示，状态变化时同步，避免与页内标题重复。 */
        syncNavTitle() {
            const title = this.recordKey ? '核对产品档案' : this.purpose === 'bom' ? '建立产品物料档案' : '指令单录入'
            uni.setNavigationBarTitle({ title })
        },
        async observeExisting() {
            const key = String(this.form[this.purpose === 'bom' ? 'productCode' : 'orderNo'] || '').trim()
            if (!(this.purpose === 'bom' ? /^\d{10}$/ : /^\d{4,12}$/).test(key)) return null
            const existing = this.purpose === 'bom' ? await fetchMaterialsByCode(key, callCloud) : await callCloud('production-orders', 'get', { orderNo: key })
            this.observedKey = key; this.observedVersion = existing ? Number(existing.version) || 1 : 0
            this.form.enabled = existing ? existing.enabled !== false : true
            return existing
        },
        async reloadLatest() {
            const yes = await new Promise(resolve => uni.showModal({ title: '重新加载最新记录', content: '将用云端最新内容替换当前尚未保存的修改。加载后请重新核对再保存。', success: result => resolve(result.confirm), fail: () => resolve(false) }))
            if (!yes) return
            this.saving = true; this.error = ''
            try {
                const record = await this.observeExisting()
                if (!record) throw new Error('记录不存在，请重新识别后录入')
                this.images = []; this.resetRecognition(); this.form = { ...record, uncertain: [] }; this.uiStage = 'review'; this.formEpoch++; this.formSource = record.source || 'manual'; this.conflicted = false
            } catch (error) { this.error = error.message || '加载失败，请重试' }
            finally { this.saving = false }
        },
        /** 从核对后的订单材料首次建档；固定 expectedVersion=0，禁止覆盖已有 BOM。 */
        async createProductArchive() {
            if (this.busy || this.purpose !== 'order' || this.needsProductCodeConfirmation || !this.form) return
            const code = String(this.form.productCode || '').trim()
            if (!/^\d{10}$/.test(code) || !String(this.form.productName || '').trim() || !String(this.form.packSpec || '').trim()) { this.error = '请核对 10 位产品编码、产品名称和包装规格'; return }
            if (!this.form.materials.length || this.form.materials.some(row => !String(row.materialCode || '').trim() || !String(row.unit || '').trim())) { this.error = '请核对材料清单，每行须有物料编号和计量单位'; return }
            this.saving = true; this.error = ''; this.productArchiveMessage = ''
            try {
                const existing = await fetchMaterialsByCode(code, callCloud)
                if (!existing) {
                    if (this.form.sourceDocumentId) await archiveOcrSource(callCloud, this.images, this.form)
                    await upsertProductMaterials({ productCode: code, productName: this.form.productName, packSpec: this.form.packSpec, materials: this.form.materials.map(row => ({ ...row })), source: this.formSource, enabled: true, sourceDocumentId: this.form.sourceDocumentId || '', recognitionRunId: this.form.recognitionRunId || '' }, 0, callCloud)
                }
                this.archivedProductCode = code
                this.productArchiveMessage = existing ? '产品 BOM 已存在，已跳过建档。' : '产品 BOM 已建立，后续同编码导入将直接复用。'
                uni.showToast({ title: existing ? '产品已建档，已跳过' : '产品 BOM 已建立', icon: 'none' })
            } catch (error) {
                if (error.code === 409) {
                    try {
                        if (await fetchMaterialsByCode(code, callCloud)) {
                            this.archivedProductCode = code; this.productArchiveMessage = '此产品已由其他人建档，已跳过。'
                            uni.showToast({ title: '产品已建档，已跳过', icon: 'none' })
                            return
                        }
                    } catch (lookupError) { this.error = lookupError.message || '暂时无法确认产品档案，请稍后重试'; return }
                }
                this.error = error.message || '产品建档失败，请稍后重试'
            } finally { this.saving = false }
        },
        async save() {
            if (this.busy) return
            if (this.needsProductCodeConfirmation) { this.error = '请先确认产品编码并继续识别，再核对后保存'; return }
            this.error = ''; this.savedMessage = ''
            const form = this.form
            if (!form || !/^\d{10}$/.test(String(form.productCode || '').trim()) || !String(form.productName || '').trim() || !String(form.packSpec || '').trim()) { this.error = '请填写 10 位产品编码、产品名称和包装规格'; return }
            if (!form.materials.length || form.materials.some(row => !String(row.materialCode || '').trim() || !String(row.unit || '').trim())) { this.error = '请核对材料清单，每行须有物料编号和计量单位'; return }
            if (this.purpose === 'order' && (!/^\d{4,12}$/.test(String(form.orderNo || '').trim()) || !batchIsValid(String(form.batchNo || '').trim().toUpperCase()))) { this.error = '请填写正确的订单号和批号（支持 B 单后缀）'; return }
            this.saving = true
            try {
                const key = String(form[this.purpose === 'bom' ? 'productCode' : 'orderNo']).trim()
                if (key !== this.observedKey || this.observedVersion === null) await this.observeExisting()
                if (this.observedVersion > 0) {
                    const yes = await new Promise(resolve => uni.showModal({ title: '更新已有记录', content: key + ' 已有记录，确认用当前核对后的内容更新？', success: result => resolve(result.confirm), fail: () => resolve(false) }))
                    if (!yes) return
                }
                if (this.observedVersion > 0 && !String(form.changeReason || '').trim()) throw new Error('请填写修改原因')
                if (form.sourceDocumentId) await archiveOcrSource(callCloud, this.images, form)
                const result = this.purpose === 'bom' ? await upsertProductMaterials({ ...form, source: this.formSource }, this.observedVersion, callCloud) : await callCloud('production-orders', 'save', { record: { ...form, uncertain: [] }, expectedVersion: this.observedVersion })
                this.observedVersion = result.version
                this.savedMessage = result.unchanged ? '内容相同，档案已存在。' : (this.purpose === 'bom' ? '产品物料已保存，可在档案页和后台查看。' : '生产订单已保存，可在后台查看。')
                uni.showToast({ title: '已保存', icon: 'none' })
            } catch (error) { this.error = error.message || '保存失败，请重试'; this.conflicted = error.code === 409 }
            finally { this.saving = false }
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.entry-page { padding-bottom: calc(190rpx + env(safe-area-inset-bottom)); }
/* 旧版微信 WebView 不支持 flex/grid gap：统一用 margin 保持视觉不变 */
.status-options { display: flex; padding: 6rpx; border-radius: 22.4rpx; background: $line; margin-bottom: 20rpx; }
.status-options button + button { margin-left: 6rpx; }
.status-options button { flex: 1; margin: 0; padding: 12rpx 6rpx; font-size: 28rpx; line-height: 1.5; background: transparent; color: $muted; border-radius: 16rpx; }
.status-options button::after { border: 0; }
.status-options button.active { background: $surface; color: $primary; font-weight: 600; }
.photo-empty { display: flex; flex-direction: column; align-items: center; padding: 32rpx 12rpx; background: $canvas; border: 1px dashed $line; border-radius: 20.8rpx; }
.photo-empty .photo-empty-title, .photo-empty .fw-note { margin-top: 12rpx; }
.photo-symbol { color: $primary; font-size: 64rpx; }.photo-empty-title { font-size: 30rpx; font-weight: 600; }
.photos { display: flex; flex-wrap: wrap; margin: 0 -12rpx -12rpx 0; }.photo-item { box-sizing: border-box; position: relative; width: calc((100% - 36rpx) / 3); min-width: 0; margin: 0 12rpx 12rpx 0; padding-bottom: 24rpx; }
.photo-item image { width: 100%; height: 256rpx; border-radius: 16rpx; background: $canvas; }
.photo-page { display: block; text-align: center; color: $muted; font-size: 24rpx; padding: 8rpx 0; }
.photo-remove { position: absolute; right: -8rpx; top: -8rpx; margin: 0; padding: 0; width: 72rpx; height: 72rpx; font-size: 40rpx; line-height: 72rpx; border-radius: 50%; background: $ink; color: $surface; }
.photo-remove::after, .photo-first::after { border: 0; }.photo-first { margin: 0; padding: 4rpx 0; font-size: 22rpx; line-height: 1.8; color: $primary; background: $primary-soft; border-radius: 9.6rpx; }
.photo-actions { display: flex; margin: 20rpx 0 0; }.photo-btn { flex: 1 1 0; min-width: 120rpx; }.photo-actions .photo-btn + .photo-btn { margin-left: 12rpx; }.photo-clear-row { display: flex; justify-content: flex-end; margin: 2rpx 0 2rpx; }.photo-clear { font-size: 24rpx; color: $muted; padding: 8rpx 0 8rpx 16rpx; }
.flow-line { display: flex; align-items: center; justify-content: space-between; margin-top: var(--sp-12, 12rpx); padding-top: var(--sp-12, 12rpx); border-top: 1px solid $line; }
.flow-line .fw-badge { margin-left: var(--sp-8, 8rpx); }
.draft-line { display: flex; align-items: center; justify-content: space-between; margin-top: var(--sp-8, 8rpx); }
.draft-line .draft-link { margin-left: var(--sp-8, 8rpx); }
.draft-link { color: $primary; font-size: var(--fs-24, 24rpx); padding: var(--sp-8, 8rpx) 0 var(--sp-8, 8rpx) var(--sp-12, 12rpx); }
.manual-entry { margin: 20rpx 0 0; width: 100%; font-size: 24rpx; line-height: 80rpx; background: $surface; color: $primary; padding: 0; border-top: 1px solid $line; border-radius: 0; }.manual-entry::after { border: 0; }
.recognize-card { display: flex; flex-direction: column; }
.recognize-card .fw-note, .recognize-card .recognize-track, .recognize-card .recognize-error, .recognize-card .recognize-lease, .recognize-card .fw-field { margin-top: var(--sp-8, 8rpx); }
.recognize-head { display: flex; align-items: center; justify-content: space-between; }
.recognize-head .recognize-elapsed, .recognize-head .fw-badge { margin-left: var(--sp-8, 8rpx); }
.recognize-title { font-size: var(--fs-30, 30rpx); font-weight: 700; }
.recognize-elapsed { color: $primary; font-size: var(--fs-24, 24rpx); font-weight: 600; }
.recognize-track { height: 8rpx; border-radius: 999rpx; background: $canvas; overflow: hidden; }
.recognize-bar { height: 100%; width: 40%; border-radius: 999rpx; background: $primary; animation: recognize-slide 1.2s ease-in-out infinite; }
@keyframes recognize-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
.recognize-error { color: $danger; font-size: var(--fs-24, 24rpx); line-height: 1.5; }
.recognize-lease { color: $warning; font-size: var(--fs-24, 24rpx); line-height: 1.5; }
.recognition-note { margin-top: 16rpx; color: $primary; font-size: 24rpx; line-height: 1.6; }.code-confirmation { margin-top: 20rpx; padding-top: 20rpx; border-top: 1px solid $line; }.code-confirmation .fw-field { margin-top: 16rpx; }
.review-summary { display: flex; align-items: center; justify-content: space-between; }.review-summary .fw-button { flex-shrink: 0; margin-left: 16rpx; font-size: 24rpx; padding: 0 14rpx; }
.code-row { display: flex; align-items: flex-end; margin-bottom: 20rpx; }.code-row .fw-field { flex: 1; min-width: 0; margin-bottom: 0; }.code-row .fw-button { margin-left: 12rpx; min-height: 92.8rpx; line-height: 92.8rpx; }
.status-help { display: block; font-size: 23rpx; font-weight: normal; margin-top: 6rpx; }.status-options { background: $canvas; }
.archive-option { margin-top: 20rpx; padding-top: 20rpx; border-top: 1px solid $line; }.archive-option .fw-button { margin-top: 14rpx; width: 100%; }
.fallback-card { border-left: 6.4rpx solid #d08700; }
.fallback-text { margin-top: 12rpx; padding: 12rpx; background: #f7f7f2; border-radius: 9.6rpx; font-size: 24rpx; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 192rpx; overflow: hidden; }
.fallback-text.expanded { max-height: none; }
</style>
