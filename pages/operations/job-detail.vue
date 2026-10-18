<template>
    <view class="fw-page op-page">
        <view class="op-toolbar"><button class="fw-button secondary" :disabled="loading || saving" @tap="load">{{ loading ? '加载中…' : '刷新工单' }}</button></view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <template v-if="job">
            <view class="fw-card"><view class="fw-heading"><text class="fw-heading-title">{{ job.productName }}</text><text class="fw-badge">{{ states[job.state] }}</text></view><text class="op-code">{{ job.batchNo }} · {{ job.productCode }}</text><text class="op-meta">{{ job.processName }} · {{ job.workshopName }}</text><text class="op-meta">责任人员：{{ (job.personNames || []).join('、') || '未派工' }}</text><text class="op-meta">采用订单 {{ job.orderNo }} · V{{ job.orderVersion }} / 工单 V{{ job.version }}</text><view class="op-grid"><view><text class="op-number">{{ job.goodQty || 0 }}</text><text class="op-meta">合格 {{ units[job.unit] }}</text></view><view><text class="op-number">{{ job.defectQty || 0 }}</text><text class="op-meta">不良 {{ units[job.unit] }}</text></view><view><text class="op-number">{{ job.inboundQty || 0 }}</text><text class="op-meta">已确认入库 {{ units[job.unit] }}</text></view><view><text class="op-number">{{ job.targetQty }}</text><text class="op-meta">目标 {{ units[job.unit] }}</text></view></view><view class="fw-actions"><button class="fw-button primary" :disabled="saving" @tap="calculate">包材计算</button><button class="fw-button" @tap="trace">批次追溯</button><button class="fw-button" @tap="exception">登记异常</button></view></view>
            <view v-if="canOperate && job.state === 'planned'" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">开工配置</text></view><ops-select v-model="start.equipmentId" label="设备" :items="equipment" :disabled="saving" optional /><ops-select v-model="start.mouldId" label="模具" :items="moulds" :disabled="saving" optional /><view class="fw-field"><text class="fw-label">实测设备参数 / 封口参数</text><textarea v-model="start.parameters" class="fw-textarea" :disabled="saving" maxlength="2000" placeholder="如温度、压力、封口时间；无设备时填操作说明" /></view><view class="fw-field"><text class="fw-label">开工说明</text><input v-model="start.note" class="fw-input" :disabled="saving" maxlength="1000" /></view><button class="fw-button primary" :disabled="saving" @tap="command('start', start)">确认开工</button></view>
            <view v-if="canOperate && job.state === 'running'" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">班次报工</text><text class="fw-note">单位：{{ units[job.unit] }}</text></view><view class="fw-field"><text class="fw-label">报工日期（排班生产日）</text><picker mode="date" :value="report.date" :disabled="saving" @change="report.date = $event.detail.value"><view class="fw-input">{{ report.date }}</view></picker></view><ops-select v-model="report.shiftId" label="班次 *" :items="catalogs.shifts || []" :disabled="saving" /><view class="fw-field-grid"><view class="fw-field"><text class="fw-label">合格数量 *</text><input v-model="report.goodQty" class="fw-input" type="digit" :disabled="saving" /></view><view class="fw-field"><text class="fw-label">不良数量 *</text><input v-model="report.defectQty" class="fw-input" type="digit" :disabled="saving" /></view></view><view class="fw-field"><text class="fw-label">本次实际工时（小时）*</text><input v-model="report.workHours" class="fw-input" type="digit" :disabled="saving" /></view><view class="fw-field"><text class="fw-label">报工备注</text><textarea v-model="report.note" class="fw-textarea" maxlength="1000" :disabled="saving" /></view><text class="op-meta">八小时夜班归属前一天的排班生产日。只填写本次新增数量。已接受的报工不能直接改写。</text><button class="fw-button primary" :disabled="saving" @tap="sendReport">提交本次报工</button></view>
            <view v-if="canOperate && job.state !== 'planned'" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">生产入库确认</text></view><view class="fw-field"><text class="fw-label">本次入库数量（{{ units[job.unit] }}）*</text><input v-model="inbound.qty" class="fw-input" type="digit" :disabled="saving" /></view><view class="fw-field"><text class="fw-label">入库凭证单号</text><input v-model="inbound.documentNo" class="fw-input" maxlength="80" :disabled="saving" /></view><view class="fw-field"><text class="fw-label">说明</text><input v-model="inbound.note" class="fw-input" maxlength="1000" :disabled="saving" /></view><text class="op-meta">登记本工单的入库确认；不改变库存账。</text><button class="fw-button" :disabled="saving" @tap="sendInbound">确认本次入库</button></view>
            <view v-if="canOperate && (job.state === 'running' || job.state === 'paused')" class="fw-card"><view class="fw-field"><text class="fw-label">暂停、继续或完工说明 *</text><textarea v-model="stateNote" class="fw-textarea" :disabled="saving" maxlength="1000" placeholder="填写原因和现场状态" /></view><view class="fw-actions"><button v-if="job.state === 'running'" class="fw-button secondary" :disabled="saving" @tap="stateCommand('pause')">暂停</button><button v-if="job.state === 'paused'" class="fw-button primary" :disabled="saving" @tap="stateCommand('resume')">继续生产</button><button class="fw-button" :disabled="saving" @tap="stateCommand('complete')">确认完工</button></view></view>
            <view v-if="!canOperate" class="fw-notice warning">本工单的执行操作由责任人员或所属车间负责人完成。</view>
            <view class="fw-card"><view class="fw-heading"><text class="fw-heading-title">执行记录</text></view><view v-for="event in eventItems" :key="event.key" class="op-event"><text class="op-name">{{ eventNames[event.type] || event.type }}</text><text class="op-meta">{{ event.actorName }} · {{ time(event.at) }}</text><text v-if="event.type === 'report'" class="op-meta">{{ event.date }} {{ name(catalogs.shifts, event.shiftId) }} / 合格 {{ event.goodQty }} / 不良 {{ event.defectQty }} {{ units[job.unit] }} / {{ event.workHours }} 小时</text><text v-if="event.type === 'inbound'" class="op-meta">入库 {{ event.qty }} {{ units[job.unit] }} · {{ event.documentNo || '无凭证单号' }}</text><text v-if="event.parameters" class="op-pre">{{ event.parameters }}</text><text class="op-meta">{{ event.note }}</text></view><text v-if="!events.length" class="op-meta">暂无执行记录。</text></view>
        </template>
    </view>
</template>
<script>
import OpsSelect from '@/components/operations/OpsSelect.vue'
import { getUser } from '@/utils/auth.js'
import { callOperations, operationsPage, loadOperations, operationDate, operationRequest, openJobCalculation, operationName, JOB_STATES, OPERATION_UNITS, EVENT_NAMES } from '@/utils/operations-api.js'
export default {
    components: { OpsSelect }, mixins: [operationsPage],
    data() { return { id: '', job: null, events: [], catalogs: {}, profile: {}, states: JOB_STATES, units: OPERATION_UNITS, eventNames: EVENT_NAMES, start: { equipmentId: '', mouldId: '', parameters: '', note: '' }, report: { date: operationDate(), shiftId: '', goodQty: '', defectQty: '', workHours: '', note: '' }, inbound: { qty: '', documentNo: '', note: '' }, stateNote: '' } },
    computed: {
        /** 非 H5 平台的 :key 不支持表达式，这里给执行记录预计算稳定 key。 */
        eventItems() { return (this.events || []).map(event => ({ ...event, key: event.requestId || ('v' + event.version) })) },
        canOperate() { return this.profile.isAdmin || this.profile.scopeRole === 'workshop_manager' || this.job && (this.job.personIds || []).includes(this.profile.personId) },
        equipment() { return (this.catalogs.resources || []).filter(item => item.kind === 'equipment' && item.workshopId === this.job.workshopId && (!item.processId || item.processId === this.job.processId)) },
        moulds() { return (this.catalogs.resources || []).filter(item => item.kind === 'mould' && item.workshopId === this.job.workshopId && (!item.processId || item.processId === this.job.processId)) }
    },
    onLoad(options) { this.id = options.id || '' }, onShow() { if (this.id) this.load(); else this.error = '缺少工单编号，请返回工单列表' },
    methods: {
        load() { return loadOperations(this, () => Promise.all([callOperations('bootstrap'), callOperations('getJob', { id: this.id })]), ([base, result]) => { this.profile = base.profile; this.catalogs = base.catalogs; this.job = result.job; this.events = result.events || [] }) },
        clearLoaded() { this.job = null; this.events = []; this.catalogs = {}; this.profile = {} }, name: operationName,
        time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' },
        calculate() { openJobCalculation(this.job) },
        trace() { uni.navigateTo({ url: '/pages/operations/trace?batchNo=' + this.job.batchNo }) },
        exception() { uni.navigateTo({ url: '/pages/operations/exceptions?jobId=' + encodeURIComponent(this.job._id) }) },
        async command(command, payload) {
            if (this.saving || this.loading || !getUser()) return
            this.saving = true; this.error = ''
            const data = JSON.parse(JSON.stringify(payload))
            try {
                const requestId = operationRequest(this, command, data)
                this.job = await callOperations('jobCommand', { id: this.id, expectedVersion: this.job.version, requestId, command, payload: data })
                this.pendingRequest = null
                if (command === 'report') this.report = { ...this.report, goodQty: '', defectQty: '', workHours: '', note: '' }
                if (command === 'inbound') this.inbound = { qty: '', documentNo: '', note: '' }
                this.stateNote = ''; uni.showToast({ title: '已登记', icon: 'success' }); await this.load()
            } catch (error) { this.error = error.message; if (error.code === 409) this.error += '；请刷新工单核对后再操作。' }
            finally { this.saving = false }
        },
        sendReport() {
            if (!this.report.shiftId || ['goodQty', 'defectQty', 'workHours'].some(key => this.report[key] === '' || !Number.isFinite(Number(this.report[key])) || Number(this.report[key]) < 0)) { this.error = '请选择班次并填写非负数量与实际工时'; return }
            this.command('report', { ...this.report, goodQty: Number(this.report.goodQty), defectQty: Number(this.report.defectQty), workHours: Number(this.report.workHours) })
        },
        sendInbound() { if (!Number.isFinite(Number(this.inbound.qty)) || Number(this.inbound.qty) <= 0) { this.error = '入库数量须大于 0'; return }; this.command('inbound', { ...this.inbound, qty: Number(this.inbound.qty) }) },
        stateCommand(command) {
            if (!this.stateNote.trim()) { this.error = '请填写现场说明'; return }
            if (command !== 'complete') { this.command(command, { note: this.stateNote }); return }
            uni.showModal({ title: '确认完工', content: '请核对报工数量和异常情况。完工后停止新增报工，入库确认仍可继续。', success: result => { if (result.confirm) this.command(command, { note: this.stateNote }) } })
        }
    }
}
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
