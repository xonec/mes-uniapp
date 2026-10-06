<template>
    <view class="fw-page entry-page">
        <view class="fw-header">
            <text class="fw-eyebrow">包装指令单录入</text>
            <text class="fw-title">{{ recordKey ? '核对产品档案' : purpose === 'bom' ? '建立产品物料档案' : '录入生产订单' }}</text>
            <text class="fw-subtitle">{{ purpose === 'bom' ? '以产品编码建档，保留固定规格和材料清单。' : '按本单核对客户、材料和上托要求。' }}</text>
        </view>
        <view v-if="!recordKey" class="purpose-tabs">
            <button :class="{ active: purpose === 'bom' }" :disabled="busy" @tap="switchPurpose('bom')">产品物料</button>
            <button :class="{ active: purpose === 'order' }" :disabled="busy" @tap="switchPurpose('order')">生产订单</button>
        </view>
        <view class="steps">
            <view v-for="(label, index) in ['选照片', '识别', '核对保存']" :key="label" class="step" :class="{ active: stageIndex === index, complete: stageIndex > index }">
                <text class="step-number">{{ stageIndex > index ? '✓' : index + 1 }}</text><text>{{ label }}</text>
            </view>
        </view>
        <view v-if="error || savedMessage || conflicted" id="entry-feedback">
            <view v-if="error" class="fw-notice error">{{ error }}</view>
            <button v-if="conflicted" class="fw-button secondary" :disabled="busy" @tap="reloadLatest">重新加载最新记录</button>
            <view v-if="savedMessage" class="fw-notice">{{ savedMessage }}</view>
        </view>
        <view v-if="uiStage !== 'review'" class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">指令单照片</text><text class="fw-badge muted">{{ images.length }} / 6 张</text></view>
            <view v-if="!images.length" class="photo-empty">
                <text class="photo-symbol">▤</text><text class="photo-empty-title">拍下首页，再补充材料清单</text>
                <text class="fw-note">同一份指令单可选多页，产品编码要清晰。</text>
            </view>
            <view v-else class="photos">
                <view v-for="(photo, index) in images" :key="photo.originalHash || photo.path" class="photo-item">
                    <image :src="photo.path" mode="aspectFill" @tap="preview(index)" />
                    <text class="photo-page">{{ index === 0 ? '首页' : '第 ' + (index + 1) + ' 页' }}</text>
                    <button class="photo-remove" :disabled="busy" @tap="removePhoto(index)" :aria-label="'删除第' + (index + 1) + '张照片'">×</button>
                    <button v-if="index > 0" class="photo-first" :disabled="busy" @tap="makeFirst(index)">设为首页</button>
                </view>
            </view>
            <view class="fw-actions photo-actions">
                <button class="fw-button" :disabled="busy || images.length >= 6" @tap="choose(['camera'])">拍照</button>
                <button class="fw-button" :disabled="busy || images.length >= 6" @tap="choose(['album'])">相册选图</button>
                <text v-if="images.length" class="fw-link" @tap="clearPhotos">清空</text>
            </view>
            <view class="fw-note">重复照片自动去重。初筛使用处理后的图片，完整识别使用原图。</view>
            <button v-if="!form && !recordKey" class="manual-entry" :disabled="busy" @tap="startManual">没有照片？手动录入或载入档案 ›</button>
        </view>
        <view v-if="uiStage !== 'review' && images.length" class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">选择识别方式</text><text class="fw-badge">优先省额度</text></view>
            <text class="fw-note">先提取编码查询档案，新产品再使用大模型。订单材料仍需按本单核对。</text>
            <button class="model-action" :disabled="busy" @tap="recognize('', true)"><text>用原图完整识别</text><text class="model-cost">使用模型额度 ›</text></button>
            <view v-if="recognitionMessage" class="recognition-note">{{ recognitionMessage }}</view>
            <view v-if="needsProductCodeConfirmation" class="code-confirmation">
                <view class="fw-heading-title">初筛未确认产品编码</view>
                <text class="fw-note">可完整识别原图，也可核对首页后填写编码继续。</text>
                <view class="fw-field"><text class="fw-label">确认产品编码</text><input class="fw-input" v-model="confirmedProductCode" :disabled="busy || !!recordKey" type="number" maxlength="10" placeholder="10 位数字" /></view>
                <button class="fw-button" :disabled="busy" @tap="confirmProductCode">确认编码并继续</button>
            </view>
        </view>
        <view v-if="form && uiStage === 'review'">
            <view class="review-summary fw-card">
                <view><text class="fw-heading-title">核对录入内容</text><text class="fw-subtitle">{{ images.length ? images.length + ' 张本次识别照片' : form.sourceDocumentId ? '已关联原始单据' : '手动录入' }}</text></view>
                <button class="fw-button secondary" :disabled="busy" @tap="uiStage = 'photos'">{{ images.length ? '查看照片' : '使用照片' }}</button>
            </view>
            <view v-if="recognitionMessage" class="fw-notice">{{ recognitionMessage }}</view>
            <view v-if="uncertainText" class="fw-notice warning">待核对：{{ uncertainText }}</view>
            <view v-if="form.enabled === false" class="fw-notice warning">此记录已停用。修改后仍保留停用状态，启用请联系管理员。</view>
            <view v-if="purpose === 'order'" class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">01 · 订单信息</text><text class="fw-badge muted">本次生产</text></view>
                <view class="fw-field-grid">
                    <view class="fw-field" :class="{ warn: isUncertain('orderNo') }"><text class="fw-label">订单号 *</text><input class="fw-input" v-model="form.orderNo" :disabled="busy" type="number" maxlength="12" placeholder="4～12 位数字" /></view>
                    <view class="fw-field" :class="{ warn: isUncertain('batchNo') }"><text class="fw-label">生产批号 *</text><input class="fw-input" v-model="form.batchNo" :disabled="busy" maxlength="11" placeholder="如 APDD26X1006" /></view>
                </view>
                <view class="fw-field" :class="{ warn: isUncertain('plannedQty') }"><text class="fw-label">计划产量（件 / 箱）*</text><input class="fw-input" v-model="form.plannedQty" :disabled="busy" type="digit" placeholder="保留单据上的数量" /></view>
                <view class="fw-field"><text class="fw-label">取样说明</text><textarea class="fw-textarea" v-model="form.sampleCount" :disabled="busy" maxlength="2000" auto-height placeholder="保留完整取样要求" /></view>
            </view>
            <view class="fw-card">
                <view class="fw-heading"><text class="fw-heading-title">{{ purpose === 'order' ? '02' : '01' }} · 产品信息</text><text v-if="productArchiveExists" class="fw-badge">已有档案</text></view>
                <view class="code-row">
                    <view class="fw-field" :class="{ warn: isUncertain('productCode') }"><text class="fw-label">产品编码 *</text><input class="fw-input" v-model="form.productCode" :disabled="busy || !!recordKey" type="number" maxlength="10" placeholder="10 位数字" /></view>
                    <button class="fw-button secondary" :disabled="busy || !/^\d{10}$/.test(String(form.productCode || '').trim())" @tap="loadArchive">查档</button>
                </view>
                <view class="fw-field" :class="{ warn: isUncertain('productName') }"><text class="fw-label">产品名称 *</text><textarea class="fw-textarea" v-model="form.productName" :disabled="busy" maxlength="120" auto-height placeholder="含口味等完整名称" /></view>
                <view class="fw-field" :class="{ warn: isUncertain('packSpec') }"><text class="fw-label">固定包装规格 *</text><textarea class="fw-textarea" v-model="form.packSpec" :disabled="busy" maxlength="500" auto-height placeholder="如 1.8kg/瓶 × 4瓶/箱" /></view>
                <text class="fw-note">{{ purpose === 'order' ? '查档仅载入名称和固定规格，客户材料在下方选择。' : '查档载入已保存的产品和材料清单。' }}</text>
            </view>
            <view v-if="purpose === 'order'" class="fw-card"><PackagingSelection :value="form" :record-key="formEpoch" :call="callCloud" :disabled="busy" @loading="selectionLoading = $event" @input="form = $event" /></view>
            <view class="fw-card"><MaterialListEditor :value="form.materials" :disabled="busy" @input="form.materials = $event" /></view>
            <view v-if="purpose === 'order'" class="fw-card"><PalletEditor :value="form.pallet || {}" :disabled="busy" @input="form.pallet = $event" /></view>
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
        </view>
        <view v-if="!keyboardVisible" class="fw-footer">
            <view class="fw-footer-note">{{ footerNote }}</view>
            <view class="fw-actions">
                <button v-if="form && uiStage !== 'review' && !needsProductCodeConfirmation" class="fw-button secondary" :disabled="busy" @tap="uiStage = 'review'">返回核对</button>
                <button v-if="uiStage === 'review'" class="fw-button primary" :disabled="busy || needsProductCodeConfirmation" @tap="save">{{ saving ? '保存中…' : purpose === 'order' ? form.orderStatus === 'confirmed' ? '确认并保存订单' : '保存订单草稿' : '核对完成，保存档案' }}</button>
                <button v-else class="fw-button primary" :disabled="busy || !images.length || needsProductCodeConfirmation || photosRecognized" @tap="recognize()">{{ recognizing ? '正在识别…' : needsProductCodeConfirmation ? '请确认编码或完整识别' : photosRecognized ? '识别完成' : '识别并查档' }}</button>
            </view>
        </view>
    </view>
</template>
<script>
import { callCloud } from '@/utils/cloud-call.js'
import { chooseOcrImages, ocrImageIdentity } from '@/utils/ocr-image.js'
import { recognizeOcr, archiveOcrSource } from '@/utils/ocr-client.js'
import { fetchMaterialsByCode, upsertProductMaterials } from '@/utils/product-materials-db.js'
import MaterialListEditor from '@/components/material-list-editor/MaterialListEditor.vue'
import PackagingSelection from '@/components/traceability/PackagingSelection.vue'
import PalletEditor from '@/components/traceability/PalletEditor.vue'
import { getUser } from '@/utils/auth.js'
const FIELD_NAMES = { orderNo: '订单号', batchNo: '批号', productCode: '产品编码', productName: '产品名称', packSpec: '包装规格', plannedQty: '计划产量', sampleCount: '取样数', materials: '包装材料清单' }
export default {
    components: { MaterialListEditor, PackagingSelection, PalletEditor },
    data() { return { uiStage: 'photos', keyboardVisible: false, selectionLoading: false, formEpoch: 0, purpose: 'bom', recordKey: '', choosing: false, recognizing: false, saving: false, conflicted: false, images: [], lastRecognizedImages: [], needsProductCodeConfirmation: false, canUseModelFallback: false, confirmedProductCode: '', recognitionMessage: '', formSource: 'manual', form: null, error: '', savedMessage: '', observedKey: '', observedVersion: null, archivedProductCode: '', productArchiveMessage: '' } },
    computed: {
        busy() { return this.choosing || this.recognizing || this.saving || this.selectionLoading },
        stageIndex() { return this.uiStage === 'review' ? 2 : this.recognizing || this.needsProductCodeConfirmation ? 1 : 0 },
        footerNote() {
            if (this.selectionLoading) return '正在载入客户方案，请稍候。'
            if (this.recognizing) return '识别完成后请逐项核对，再保存。'
            if (this.uiStage !== 'review') return '先查档节省额度，也可选择完整识别原图。'
            if (this.purpose === 'order' && (!this.form.pallet || this.form.pallet.status !== 'confirmed')) return '上托要求待补充；保存后暂不计算托数。'
            return '请核对产品编码、包装规格和每一项材料。'
        },
        photosRecognized() { return this.lastRecognizedImages.length > 0 && this.images.length === this.lastRecognizedImages.length && this.images.every((image, index) => ocrImageIdentity(image) === this.lastRecognizedImages[index]) },
        productArchiveExists() { return !!this.archivedProductCode && this.archivedProductCode === String(this.form && this.form.productCode || '').trim() },
        uncertainText() { return ((this.form && this.form.uncertain) || []).map(key => FIELD_NAMES[key] || '包装材料明细').join('、') }
    },
    watch: { error(message) { if (message) this.$nextTick(() => uni.pageScrollTo({ selector: '#entry-feedback', duration: 200 })); }, 'form.productCode'(code, previous) { if (String(code || '').trim() !== String(previous || '').trim()) this.productArchiveMessage = '' } },
    async onLoad(options) {
        if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }
        this.keyboardHandler = event => { this.keyboardVisible = Number(event.height) > 0 }
        if (uni.onKeyboardHeightChange) uni.onKeyboardHeightChange(this.keyboardHandler)
        this.purpose = options.purpose === 'order' ? 'order' : 'bom'
        if (options.productCode) {
            this.recordKey = options.productCode
            this.choosing = true
            try {
                const record = await fetchMaterialsByCode(options.productCode)
                if (!record) throw new Error('产品物料档案不存在，请返回档案页刷新')
                this.form = { ...record, uncertain: [] }; this.uiStage = 'review'; this.formEpoch++
                this.formSource = record.source || 'manual'
                this.archivedProductCode = record.productCode
                this.observedKey = record.productCode; this.observedVersion = Number(record.version) || 1
            } catch (error) { this.error = error.message }
            finally { this.choosing = false }
        }
    },
    onUnload() { if (uni.offKeyboardHeightChange && this.keyboardHandler) uni.offKeyboardHeightChange(this.keyboardHandler) },
    methods: {
        callCloud,
        isUncertain(key) { return ((this.form && this.form.uncertain) || []).includes(key) },
        resetRecognition() { this.lastRecognizedImages = []; this.needsProductCodeConfirmation = false; this.canUseModelFallback = false; this.confirmedProductCode = ''; this.recognitionMessage = '' },
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
        async switchPurpose(purpose) {
            if (this.busy || purpose === this.purpose || this.recordKey) return
            if (!await this.replacePhotos([])) return
            this.purpose = purpose
        },
        startManual() {
            if (this.busy) return
            this.images = []; this.resetRecognition()
            this.form = { productCode: '', productName: '', packSpec: '', materials: [], orderNo: '', batchNo: '', plannedQty: '', sampleCount: '', uncertain: [], enabled: true, orderStatus: 'draft', customerId: '', pallet: {}, changeReason: '' }
            this.uiStage = 'review'; this.formEpoch++; this.formSource = 'manual'; this.error = ''; this.savedMessage = ''; this.observedKey = ''; this.observedVersion = null; this.archivedProductCode = ''; this.productArchiveMessage = ''
        },
        async loadArchive() {
            if (this.busy) return
            this.saving = true; this.error = ''; this.savedMessage = ''
            try {
                const record = await fetchMaterialsByCode(String(this.form.productCode || '').trim())
                if (!record) throw new Error('未找到产品档案，可手动录入或从新照片初筛并识别')
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
        /** 初筛未确认编码时，主动用大模型识别；不要求用户先手填编码。 */
        async recognizeWithModel() {
            if (this.busy || !this.canUseModelFallback || !this.needsProductCodeConfirmation) return
            await this.recognize('', true)
        },
        async recognize(confirmedProductCode = '', useModel = false) {
            const code = String(confirmedProductCode || '').trim()
            if (this.busy || (this.photosRecognized && !useModel) || !this.images.length || (this.needsProductCodeConfirmation && !code && !useModel)) return
            if (code && !/^\d{10}$/.test(code)) { this.error = '请确认 10 位纯数字产品编码'; return }
            if (useModel && this.form && !this.needsProductCodeConfirmation) {
                const yes = await new Promise(resolve => uni.showModal({ title: '完整识别原图', content: '将用本组照片的识别结果替换当前核对内容。已有结果会复用，没有结果时使用模型额度。', confirmText: '开始识别', success: result => resolve(result.confirm), fail: () => resolve(false) }))
                if (!yes) return
            }
            this.recognizing = true; this.error = ''; this.savedMessage = ''
            try {
                const result = await recognizeOcr(callCloud, this.images, this.purpose, { ...(useModel ? { useModel: true } : {}), ...(code ? { confirmedProductCode: code } : {}), ...(this.purpose === 'bom' && this.recordKey ? { expectedProductCode: this.recordKey } : {}) })
                this.recognitionMessage = typeof result.message === 'string' ? result.message : ''
                this.needsProductCodeConfirmation = result.needsProductCodeConfirmation === true
                this.canUseModelFallback = result.canUseModelFallback === true || (this.needsProductCodeConfirmation && ['ocrspace', 'local'].includes(result.recognitionSource))
                this.confirmedProductCode = this.recordKey || String(result.productCode || code || '').trim()
                if (this.recordKey && !this.needsProductCodeConfirmation && result.productCode !== this.recordKey) throw new Error('照片中的产品编码与当前产品不一致，请在新增入口导入')
                if (this.recordKey && this.needsProductCodeConfirmation) {
                    uni.showToast({ title: '请确认产品编码后继续', icon: 'none' })
                    return
                }
                this.form = { orderStatus: 'draft', customerId: this.form && this.form.customerId || '', customerName: this.form && this.form.customerName || '', pallet: {}, changeReason: '', ...result, materials: Array.isArray(result.materials) ? result.materials : [], enabled: result.enabled !== false }
                this.formEpoch++; this.uiStage = this.needsProductCodeConfirmation ? 'photos' : 'review'
                this.archivedProductCode = result.archiveMatched ? result.productCode : ''; this.productArchiveMessage = ''
                this.observedKey = ''; this.observedVersion = null
                let existing = null
                if (this.purpose === 'bom' && result.archiveMatched) {
                    // 保存必须使用当前表单所展示的档案版本，不能再查询后把新版本套到旧内容上。
                    this.observedKey = result.productCode
                    this.observedVersion = Number(result.version) || 1
                } else existing = await this.observeExisting()
                this.conflicted = false
                this.formSource = this.purpose === 'bom' && result.archiveMatched ? result.source || (existing && existing.source) || 'manual' : 'photo'
                this.lastRecognizedImages = !this.needsProductCodeConfirmation && (result.archiveMatched || result.modelUsed || result.recognitionSource === 'cache') ? this.images.map(ocrImageIdentity) : []
                const title = this.needsProductCodeConfirmation ? (this.canUseModelFallback ? '可使用大模型或确认编码' : '请确认产品编码后继续') : result.archiveMatched ? (result.modelUsed ? '本单完整识别完成' : '已载入产品信息，未调用大模型') : result.recognitionSource === 'cache' ? '已复用识别结果，请核对' : result.modelUsed ? '识别完成，请核对' : '初筛完成，请核对'
                uni.showToast({ title, icon: 'none' })
            } catch (error) { this.error = error.message || '识别失败，请重试' }
            finally { this.recognizing = false }
        },
        async observeExisting() {
            const key = String(this.form[this.purpose === 'bom' ? 'productCode' : 'orderNo'] || '').trim()
            if (!(this.purpose === 'bom' ? /^\d{10}$/ : /^\d{4,12}$/).test(key)) return null
            const existing = this.purpose === 'bom' ? await fetchMaterialsByCode(key) : await callCloud('production-orders', 'get', { orderNo: key })
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
                const existing = await fetchMaterialsByCode(code)
                if (!existing) {
                    if (this.form.sourceDocumentId) await archiveOcrSource(callCloud, this.images, this.form)
                    await upsertProductMaterials({ productCode: code, productName: this.form.productName, packSpec: this.form.packSpec, materials: this.form.materials.map(row => ({ ...row })), source: this.formSource, enabled: true, sourceDocumentId: this.form.sourceDocumentId || '', recognitionRunId: this.form.recognitionRunId || '' }, 0)
                }
                this.archivedProductCode = code
                this.productArchiveMessage = existing ? '产品 BOM 已存在，已跳过建档。' : '产品 BOM 已建立，后续同编码导入将直接复用。'
                uni.showToast({ title: existing ? '产品已建档，已跳过' : '产品 BOM 已建立', icon: 'none' })
            } catch (error) {
                if (error.code === 409) {
                    try {
                        if (await fetchMaterialsByCode(code)) {
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
            if (this.purpose === 'order' && (!/^\d{4,12}$/.test(String(form.orderNo || '').trim()) || !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(String(form.batchNo || '').trim().toUpperCase()))) { this.error = '请填写正确的订单号和 11 位批号'; return }
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
                const result = this.purpose === 'bom' ? await upsertProductMaterials({ ...form, source: this.formSource }, this.observedVersion) : await callCloud('production-orders', 'save', { record: { ...form, uncertain: [] }, expectedVersion: this.observedVersion })
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
.entry-page { padding-bottom: calc(7rem + env(safe-area-inset-bottom)); }
.purpose-tabs, .status-options { display: flex; padding: .25rem; gap: .3rem; border-radius: .7rem; background: $line; margin-bottom: 1rem; }
.purpose-tabs button, .status-options button { flex: 1; margin: 0; padding: .6rem .3rem; font-size: .9rem; line-height: 1.5; background: transparent; color: $muted; border-radius: .5rem; }
.purpose-tabs button::after, .status-options button::after { border: 0; }
.purpose-tabs button.active, .status-options button.active { background: $surface; color: $primary; font-weight: 600; }
.steps { display: flex; justify-content: space-between; gap: .3rem; padding: .1rem 0 1.1rem; }
.step { display: flex; align-items: center; gap: .35rem; font-size: .8rem; color: $muted; }
.step-number { width: 1.55rem; height: 1.55rem; line-height: 1.55rem; text-align: center; background: $line; border-radius: 50%; }
.step.active { color: $primary; font-weight: 600; }.step.active .step-number { background: $primary; color: $surface; }.step.complete .step-number { color: $primary; background: $primary-soft; }
.photo-empty { display: flex; flex-direction: column; align-items: center; gap: .55rem; padding: 1.5rem .5rem; background: $canvas; border: 1px dashed $line; border-radius: .65rem; }
.photo-symbol { color: $primary; font-size: 2rem; }.photo-empty-title { font-size: .95rem; font-weight: 600; }
.photos { display: flex; flex-wrap: wrap; gap: .6rem; }.photo-item { position: relative; width: calc((100% - 1.2rem) / 3); min-width: 0; padding-bottom: 1.1rem; }
.photo-item image { width: 100%; height: 8rem; border-radius: .5rem; background: $canvas; }
.photo-page { display: block; text-align: center; color: $muted; font-size: .75rem; padding: .35rem 0; }
.photo-remove { position: absolute; right: -.2rem; top: -.2rem; margin: 0; padding: 0; width: 2rem; height: 2rem; font-size: 1.25rem; line-height: 2rem; border-radius: 50%; background: $ink; color: $surface; }
.photo-remove::after, .photo-first::after { border: 0; }.photo-first { margin: 0; padding: .2rem 0; font-size: .7rem; line-height: 1.8; color: $primary; background: $primary-soft; border-radius: .3rem; }
.photo-actions { margin: 1rem 0 .7rem; align-items: center; }.photo-actions .fw-button { flex: 1; }
.manual-entry { margin: 1rem 0 0; width: 100%; font-size: .8rem; line-height: 2.5rem; background: $surface; color: $primary; padding: 0; border-top: 1px solid $line; border-radius: 0; }.manual-entry::after { border: 0; }
.model-action { margin: .9rem 0 0; padding: .85rem .75rem; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: .5rem; background: $canvas; border-radius: .5rem; font-size: .85rem; line-height: 1.6; }.model-action::after { border: 0; }.model-cost { font-size: .7rem; color: $warning; }
.recognition-note { margin-top: .75rem; color: $primary; font-size: .8rem; line-height: 1.6; }.code-confirmation { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid $line; }.code-confirmation .fw-field { margin-top: .75rem; }
.review-summary { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }.review-summary .fw-button { flex-shrink: 0; font-size: .8rem; padding: 0 .7rem; }
.code-row { display: flex; align-items: flex-end; gap: .6rem; margin-bottom: .9rem; }.code-row .fw-field { flex: 1; min-width: 0; margin-bottom: 0; }.code-row .fw-button { min-height: 2.9rem; line-height: 2.9rem; }
.status-help { display: block; font-size: .72rem; font-weight: normal; margin-top: .25rem; }.status-options { background: $canvas; }
.archive-option { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid $line; }.archive-option .fw-button { margin-top: .7rem; width: 100%; }
</style>
