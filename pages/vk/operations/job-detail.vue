<template>
    <view class="fw-page" :class="{ 'has-action-bar': job && canOperate }">
        <!-- ① 单层吸顶摘要（不透明 $canvas + 底部 1px $line；刷新唯一入口） -->
        <view class="jd-sticky">
            <view class="jd-head-line">
                <text class="jd-title">{{ job ? job.productName : '工单详情' }}</text>
                <text v-if="job" class="fw-badge" :class="'tone-' + stateTone">{{ states[job.state] }}</text>
                <view class="jd-refresh" aria-label="刷新工单" @tap="load">
                    <uni-icons type="refresh" size="16" color="#008577"></uni-icons>
                </view>
            </view>
            <view v-if="job" class="jd-head-meta">
                <view class="jd-meta-left">
                    <text class="jd-code" @tap="trace">{{ job.batchNo }}</text>
                    <text class="jd-meta-text"> · {{ job.processName }} · {{ job.workshopName }}</text>
                </view>
                <text class="jd-unit">单位：{{ units[job.unit] }}</text>
            </view>
        </view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <template v-if="job">
            <!-- ② 关键数字条（短词 label，单位在摘要处写一次） -->
            <MetricStrip :items="metrics" :columns="4" />

            <!-- ③ tabs 随内容滚动 -->
            <view class="jd-tabs">
                <view v-for="tab in tabs" :key="tab.key" class="jd-tab" :class="{ active: activeTab === tab.key }" @tap="switchTab(tab.key)">
                    <text class="jd-tab-text">{{ tab.label }}</text>
                    <view v-if="canOperate && tab.key === 'config' && job.state === 'planned'" class="jd-tab-dot"></view>
                </view>
            </view>

            <!-- 报工 -->
            <template v-if="activeTab === 'report'">
                <view v-if="canOperate && job.state === 'running'" class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">班次报工</text><text class="fw-note">单位：{{ units[job.unit] }}</text></view>
                    <view class="fw-field"><text class="fw-label">报工日期（排班生产日）</text><picker mode="date" :value="report.date" :disabled="saving" @change="report.date = $event.detail.value"><view class="fw-input">{{ report.date }}</view></picker></view>
                    <ops-select v-model="report.shiftId" label="班次 *" :items="catalogs.shifts || []" :disabled="saving" />
                    <view class="fw-field-grid">
                        <view class="fw-field"><text class="fw-label">合格数量 *</text><input v-model="report.goodQty" class="fw-input" type="digit" :disabled="saving" /></view>
                        <view class="fw-field"><text class="fw-label">不良数量 *</text><input v-model="report.defectQty" class="fw-input" type="digit" :disabled="saving" /></view>
                    </view>
                    <view class="fw-field"><text class="fw-label">本次实际工时（小时）*</text><input v-model="report.workHours" class="fw-input" type="digit" :disabled="saving" /></view>
                    <view class="fw-field"><text class="fw-label">报工备注</text><textarea v-model="report.note" class="fw-textarea" maxlength="1000" :disabled="saving" /></view>
                    <text class="op-meta">八小时夜班归属前一天的排班生产日。只填写本次新增数量。已接受的报工不能直接改写。</text>
                </view>
                <view v-else class="fw-card"><text class="fw-note">{{ reportEmpty }}</text></view>
            </template>

            <!-- 入库 -->
            <template v-else-if="activeTab === 'inbound'">
                <view v-if="canOperate && job.state !== 'planned'" class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">生产入库确认</text></view>
                    <view class="fw-field"><text class="fw-label">本次入库数量（{{ units[job.unit] }}）*</text><input v-model="inbound.qty" class="fw-input" type="digit" :disabled="saving" /></view>
                    <view class="fw-field"><text class="fw-label">入库凭证单号</text><input v-model="inbound.documentNo" class="fw-input" maxlength="80" :disabled="saving" /></view>
                    <view class="fw-field"><text class="fw-label">说明</text><input v-model="inbound.note" class="fw-input" maxlength="1000" :disabled="saving" /></view>
                    <text class="op-meta">登记本工单的入库确认；不改变库存账。</text>
                </view>
                <view v-else class="fw-card"><text class="fw-note">{{ inboundEmpty }}</text></view>
            </template>

            <!-- 记录 -->
            <template v-else-if="activeTab === 'log'">
                <view class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">执行记录</text></view>
                    <view v-for="item in eventItems" :key="item.key" class="op-event">
                        <text class="op-name">{{ eventNames[item.type] || item.type }}</text>
                        <text class="op-meta">{{ item.actorName }} · {{ time(item.at) }}</text>
                        <text v-if="item.type === 'report'" class="op-meta">{{ item.date }} {{ name(catalogs.shifts, item.shiftId) }} / 合格 {{ item.goodQty }} / 不良 {{ item.defectQty }} {{ units[job.unit] }} / {{ item.workHours }} 小时</text>
                        <text v-if="item.type === 'inbound'" class="op-meta">入库 {{ item.qty }} {{ units[job.unit] }} · {{ item.documentNo || '无凭证单号' }}</text>
                        <text v-if="item.parameters" class="op-pre">{{ item.parameters }}</text>
                        <text class="op-meta">{{ item.note }}</text>
                    </view>
                    <text v-if="!events.length" class="op-meta">暂无执行记录。</text>
                </view>
            </template>

            <!-- 配置 -->
            <template v-else>
                <view v-if="canOperate && job.state === 'planned'" class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">开工配置</text></view>
                    <ops-select v-model="start.equipmentId" label="设备" :items="equipment" :disabled="saving" optional />
                    <ops-select v-model="start.mouldId" label="模具" :items="moulds" :disabled="saving" optional />
                    <view class="fw-field"><text class="fw-label">实测设备参数 / 封口参数</text><textarea v-model="start.parameters" class="fw-textarea" :focus="focusField === 'parameters'" :disabled="saving" maxlength="2000" placeholder="如温度、压力、封口时间；无设备时填操作说明" /></view>
                    <view class="fw-field"><text class="fw-label">开工说明</text><input v-model="start.note" class="fw-input" :focus="focusField === 'note'" :disabled="saving" maxlength="1000" /></view>
                </view>
                <view class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">工单信息</text></view>
                    <view class="fw-field"><text class="fw-label">责任人员</text><view class="jd-chips"><text v-for="person in personNames" :key="person" class="jd-chip">{{ person }}</text><text v-if="!personNames.length" class="op-meta">未派工</text></view></view>
                    <text class="op-meta">采用订单 {{ job.orderNo }} · V{{ job.orderVersion }} / 工单 V{{ job.version }}</text>
                    <text class="op-meta">计划日期：{{ job.plannedDate || '—' }}</text>
                    <text class="op-meta">设备：{{ job.equipmentName || startEquipmentName || '未配置' }}</text>
                    <text class="op-meta">模具：{{ job.mouldName || startMouldName || '未配置' }}</text>
                    <view v-if="job.startParameters" class="jd-params">
                        <text class="fw-label">开工参数</text>
                        <text class="op-pre jd-clamp" :class="{ expanded: paramsExpanded }">{{ job.startParameters }}</text>
                        <text class="jd-toggle" @tap="paramsExpanded = !paramsExpanded">{{ paramsExpanded ? '收起' : '展开全部' }}</text>
                    </view>
                </view>
                <view v-if="!canOperate" class="fw-notice warning">{{ readonlyHint }}</view>
            </template>
        </template>

        <!-- ⑤ 底部操作区：primary 按状态 + secondary 登记异常 + 更多（计算/追溯） -->
        <ActionBar v-if="job && canOperate" :primary="actionPrimary" secondary="登记异常" :note="actionNote" more :busy="saving" @primary="onPrimary" @secondary="exception" @more="openMore" />

        <!-- 暂停/继续/完工说明输入（sheet 内直接确认，完工用危险色；校验失败留在 sheet 内提示） -->
        <view v-if="sheet" class="jd-mask" @tap="closeSheet">
            <view class="jd-sheet" @tap.stop>
                <view class="jd-sheet-head">
                    <text class="jd-sheet-title">{{ sheet.title }}</text>
                    <text class="jd-sheet-close" @tap="closeSheet">×</text>
                </view>
                <view class="fw-field"><text class="fw-label">现场说明 *</text><textarea v-model="stateNote" class="fw-textarea" maxlength="1000" :disabled="saving" :focus="sheetFocus" placeholder="填写原因和现场状态" /></view>
                <view v-if="sheetError" class="fw-notice error">{{ sheetError }}</view>
                <view class="fw-actions">
                    <button class="fw-button secondary" :disabled="saving" @tap="closeSheet">取消</button>
                    <button class="fw-button" :class="sheet.command === 'complete' ? 'jd-danger' : 'primary'" :disabled="saving" @tap="confirmSheet">{{ saving ? '提交中…' : '确认' + sheet.title }}</button>
                </view>
            </view>
        </view>
    </view>
</template>
<script>
import OpsSelect from '@/components/operations/OpsSelect.vue'
import MetricStrip from '@/components/ui/MetricStrip.vue'
import ActionBar from '@/components/ui/ActionBar.vue'
import { getUser } from '@/utils/auth.js'
import { operationsPage, loadOperations, operationDate, operationRequest, openJobCalculation, operationName, JOB_STATES, OPERATION_UNITS, EVENT_NAMES } from '@/utils/operations-api.js'
import { vkOperations, vkCall, loadVkBootstrap } from '@/utils/vk-operations.js'
import { openPage, decodeParam } from '@/utils/vk-migration.js'
const TABS = [{ key: 'report', label: '报工' }, { key: 'inbound', label: '入库' }, { key: 'log', label: '记录' }, { key: 'config', label: '配置' }]
const MORE = {
    running: ['暂停生产', '确认完工', '包材计算', '批次追溯'],
    paused: ['确认完工', '包材计算', '批次追溯'],
    other: ['包材计算', '批次追溯']
}
export default {
    components: { OpsSelect, MetricStrip, ActionBar }, mixins: [operationsPage],
    data() {
        return {
            id: '', job: null, events: [], catalogs: {}, profile: {}, states: JOB_STATES, units: OPERATION_UNITS, eventNames: EVENT_NAMES,
            tabs: TABS, activeTab: '', sheet: null, sheetFocus: false, sheetError: '', focusField: '',
            paramsExpanded: false,
            start: { equipmentId: '', mouldId: '', parameters: '', note: '' },
            report: { date: operationDate(), shiftId: '', goodQty: '', defectQty: '', workHours: '', note: '' },
            inbound: { qty: '', documentNo: '', note: '' }, stateNote: ''
        }
    },
    computed: {
        /** 非 H5 平台的 :key 不支持表达式，这里给执行记录预计算稳定 key。 */
        eventItems() { return (this.events || []).map(event => ({ ...event, key: event.requestId || ('v' + event.version) })) },
        personNames() { return (this.job && this.job.personNames) || [] },
        /** 与后端 operate() 对齐：管理员/负责人可操作；操作员须被派工且仍具备该工序权限（权限被收回时只读）。 */
        assignedToMe() { return !!this.job && (this.job.personIds || []).includes(this.profile.personId) },
        processQualified() { return !!this.job && (this.profile.processIds || []).includes(this.job.processId) },
        canOperate() {
            if (!this.job) return false
            if (this.profile.isAdmin || this.profile.scopeRole === 'workshop_manager') return true
            return this.assignedToMe && this.processQualified
        },
        /** 只读提示按原因区分：已派工但工序权限被收回，和「不在本人职责范围」不是一回事。 */
        readonlyHint() {
            if (this.canOperate) return ''
            return this.assignedToMe ? '本工单已分配给本人，但当前账号已不具备该工序权限，操作已只读；请联系车间负责人调整派工。' : '本工单的执行操作由责任人员或所属车间负责人完成。'
        },
        equipment() { return (this.catalogs.resources || []).filter(item => item.kind === 'equipment' && item.workshopId === this.job.workshopId && (!item.processId || item.processId === this.job.processId)) },
        moulds() { return (this.catalogs.resources || []).filter(item => item.kind === 'mould' && item.workshopId === this.job.workshopId && (!item.processId || item.processId === this.job.processId)) },
        stateTone() { const state = this.job && this.job.state; return state === 'running' ? 'primary' : state === 'paused' ? 'warning' : 'neutral' },
        metrics() {
            return [
                { value: this.job.goodQty || 0, label: '合格', tone: 'primary' },
                { value: this.job.defectQty || 0, label: '不良', tone: this.job.defectQty ? 'danger' : 'neutral' },
                { value: this.job.inboundQty || 0, label: '入库', tone: 'neutral' },
                { value: this.job.targetQty, label: '目标', tone: 'neutral' }
            ]
        },
        actionPrimary() {
            const state = this.job.state
            if (state === 'planned') return this.activeTab === 'config' ? '确认开工' : '开工'
            if (state === 'running') return '报工'
            if (state === 'paused') return '继续生产'
            if (state === 'completed') return '确认入库'
            return ''
        },
        actionNote() {
            const map = {
                planned: '在「配置」填写开工信息后确认开工。',
                running: '报工在「报工」页提交；暂停、完工在「更多」里。',
                paused: '继续生产需填写现场说明。',
                completed: '已完工：仍可继续登记入库确认。'
            }
            return map[this.job.state] || '本工单的执行操作由责任人员或所属车间负责人完成。'
        },
        reportEmpty() {
            if (!this.canOperate) return this.readonlyHint
            if (this.job.state === 'planned') return '尚未开工，无报工记录。'
            if (this.job.state === 'paused') return '已暂停，继续生产后可报工。'
            if (this.job.state === 'completed') return '已完工，不再接受报工。'
            return '当前状态不可报工。'
        },
        inboundEmpty() {
            if (!this.canOperate) return this.readonlyHint
            if (this.job.state === 'planned') return '尚未开工，无入库记录。'
            if (!Number(this.job.inboundQty)) return '尚未入库，无入库记录。'
            return '当前状态不可登记入库。'
        },
        startEquipmentName() { const found = this.equipment.find(item => item._id === this.start.equipmentId); return found ? found.name : '' },
        startMouldName() { const found = this.moulds.find(item => item._id === this.start.mouldId); return found ? found.name : '' }
    },
    onLoad(options) { this.id = decodeParam(options.id) || '' },
    onShow() { if (this.id) this.load(); else this.error = '缺少工单编号，请返回工单列表' },
    methods: {
        /** 串行取数：先复用共享 bootstrap，再取工单，避免并发冷启动。 */
        load() {
            return loadOperations(this, async () => { const base = await loadVkBootstrap(); const result = await vkOperations('getJob', { id: this.id }); return [base, result] }, ([base, result]) => {
                this.profile = base.profile; this.catalogs = base.catalogs; this.job = result.job; this.events = result.events || []
                // 保留用户当前 tab；首次进入按状态落到最相关 tab。
                if (!this.activeTab) this.activeTab = this.job.state === 'planned' ? 'config' : this.job.state === 'completed' ? 'inbound' : 'report'
                if (!this.start.equipmentId && this.job.equipmentId) this.start.equipmentId = this.job.equipmentId
                if (!this.start.mouldId && this.job.mouldId) this.start.mouldId = this.job.mouldId
            })
        },
        clearLoaded() { this.job = null; this.events = []; this.catalogs = {}; this.profile = {} },
        switchTab(key) {
            if (this.activeTab !== key) this.activeTab = key
            this.focusField = ''
            uni.pageScrollTo({ scrollTop: 0, duration: 0 })
        },
        /** 底部主按钮：不在目标 tab 时先切换（planned 额外聚焦首个未填项），已在目标 tab 则直接提交该 tab 的表单。 */
        onPrimary() {
            const state = this.job.state
            if (state === 'planned') {
                if (this.activeTab !== 'config') {
                    this.switchTab('config')
                    this.$nextTick(() => { this.focusField = !this.start.parameters ? 'parameters' : (!this.start.note ? 'note' : '') })
                    return
                }
                this.command('start', this.start); return
            }
            if (state === 'running') {
                if (this.activeTab !== 'report') { this.switchTab('report'); return }
                this.sendReport(); return
            }
            if (state === 'completed') {
                if (this.activeTab !== 'inbound') { this.switchTab('inbound'); return }
                this.sendInbound(); return
            }
            if (state === 'paused') return this.openSheet('resume', '继续生产')
        },
        openMore() {
            const items = MORE[this.job.state] || MORE.other
            uni.showActionSheet({
                itemList: items,
                success: result => {
                    const label = items[result.tapIndex]
                    if (label === '暂停生产') return this.openSheet('pause', '暂停生产')
                    if (label === '确认完工') return this.openSheet('complete', '确认完工')
                    if (label === '包材计算') return this.calculate()
                    if (label === '批次追溯') return this.trace()
                }
            })
        },
        openSheet(command, title) { this.stateNote = ''; this.sheetError = ''; this.error = ''; this.sheet = { command, title }; this.$nextTick(() => { this.sheetFocus = true }) },
        closeSheet() { if (this.saving) return; this.sheet = null; this.sheetFocus = false; this.sheetError = '' },
        confirmSheet() {
            if (!this.sheet) return
            if (!this.stateNote.trim()) { this.sheetError = '请填写现场说明'; return }
            const command = this.sheet.command
            this.sheet = null; this.sheetFocus = false; this.sheetError = ''
            this.command(command, { note: this.stateNote })
        },
        name: operationName,
        time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' },
        calculate() { openJobCalculation(this.job) },
        trace() { openPage('operations.trace', { batchNo: this.job.batchNo }) },
        exception() { openPage('operations.exceptions', { jobId: this.job._id }) },
        async command(command, payload) {
            if (this.saving || this.loading || !getUser()) return
            this.saving = true; this.error = ''
            const data = JSON.parse(JSON.stringify(payload))
            try {
                const requestId = operationRequest(this, command, data)
                this.job = await vkCall('mes/pub/operation', { action: 'jobCommand', id: this.id, expectedVersion: this.job.version, requestId, command, payload: data }, { retry: false })
                this.pendingRequest = null
                if (command === 'report') this.report = { ...this.report, goodQty: '', defectQty: '', workHours: '', note: '' }
                if (command === 'inbound') this.inbound = { qty: '', documentNo: '', note: '' }
                this.stateNote = ''
                if (command === 'start') this.activeTab = 'report'
                if (command === 'complete') this.activeTab = 'inbound'
                uni.showToast({ title: '已登记', icon: 'success' }); await this.load()
            } catch (error) { this.error = error.message; if (error.code === 409) this.error += '；请刷新工单核对后再操作。' }
            finally { this.saving = false }
        },
        sendReport() {
            if (!this.report.shiftId || ['goodQty', 'defectQty', 'workHours'].some(key => this.report[key] === '' || !Number.isFinite(Number(this.report[key])) || Number(this.report[key]) < 0)) {
                this.error = '请选择班次并填写非负数量与实际工时'
                uni.showToast({ title: '请选择班次并填写数量与工时', icon: 'none' })
                return
            }
            this.command('report', { ...this.report, goodQty: Number(this.report.goodQty), defectQty: Number(this.report.defectQty), workHours: Number(this.report.workHours) })
        },
        sendInbound() {
            if (!Number.isFinite(Number(this.inbound.qty)) || Number(this.inbound.qty) <= 0) {
                this.error = '入库数量须大于 0'
                uni.showToast({ title: '入库数量须大于 0', icon: 'none' })
                return
            }
            this.command('inbound', { ...this.inbound, qty: Number(this.inbound.qty) })
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

/* ① 摘要单层吸顶（不透明背景 + 1px $line；z-index 低于 ActionBar 80）
   H5 的 uni 固定导航头占 0~--window-top，sticky top 必须让开，否则摘要被压在导航头下；小程序原生导航下该值为 0。 */
.jd-sticky { position: sticky; top: var(--window-top, 0px); z-index: 20; margin: -24rpx -24rpx 0; padding: 2rpx var(--sp-24, 24rpx); background: $canvas; border-bottom: 1px solid $line; }
.jd-head-line { display: flex; align-items: center; min-height: 64rpx; }
.jd-title { flex: 1; min-width: 0; font-size: var(--fs-32, 32rpx); font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.jd-head-line .fw-badge { margin-left: var(--sp-8, 8rpx); flex-shrink: 0; }
.jd-refresh { flex-shrink: 0; margin-left: var(--sp-8, 8rpx); width: 72rpx; height: 72rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: $surface; }
.jd-head-meta { display: flex; align-items: center; margin-top: 0; }
.jd-head-meta .op-meta, .jd-head-meta .jd-meta-text, .jd-head-meta .jd-code { line-height: 1.3; }
.jd-meta-left { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.jd-code { font-family: monospace; font-size: var(--fs-24, 24rpx); color: $primary; text-decoration: underline; text-underline-offset: 3rpx; }
.jd-meta-text { color: $muted; font-size: var(--fs-24, 24rpx); }
.jd-unit { flex-shrink: 0; margin-left: var(--sp-8, 8rpx); color: $muted; font-size: var(--fs-22, 22rpx); }

/* ③ tabs（随内容滚动，不吸顶） */
.jd-tabs { display: flex; margin: var(--sp-4, 4rpx) 0 0; border-bottom: 1px solid $line; }
.jd-tab { flex: 1; height: 72rpx; display: flex; align-items: center; justify-content: center; position: relative; }
.jd-tab-text { font-size: var(--fs-28, 28rpx); color: $muted; }
.jd-tab-dot { position: absolute; top: 12rpx; right: 24rpx; width: 6rpx; height: 6rpx; border-radius: 50%; background: $warning; }
.jd-tab.active .jd-tab-text { color: $primary; font-weight: 600; }
.jd-tab.active::after { content: ''; position: absolute; left: 50%; bottom: 0; width: 64rpx; height: 2rpx; margin-left: -32rpx; border-radius: 2rpx; background: $primary; }

/* 配置 tab */
.jd-chips { display: flex; flex-wrap: wrap; max-height: 96rpx; overflow: hidden; }
.jd-chip { margin: 0 var(--sp-8, 8rpx) var(--sp-8, 8rpx) 0; padding: 2rpx var(--sp-12, 12rpx); border-radius: var(--radius-badge, 8rpx); background: $canvas; color: $muted; font-size: var(--fs-22, 22rpx); }
.jd-params { margin-top: var(--sp-8, 8rpx); }
.jd-clamp { display: block; max-height: 104rpx; overflow: hidden; }
.jd-clamp.expanded { max-height: none; }
.jd-toggle { display: block; margin-top: var(--sp-4, 4rpx); color: $primary; font-size: var(--fs-24, 24rpx); }

/* 暂停/继续/完工说明 sheet */
.jd-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 95; display: flex; align-items: flex-end; background: rgba(31, 38, 34, .42); }
.jd-sheet { box-sizing: border-box; width: 100%; max-height: 86vh; overflow-y: auto; padding: var(--sp-12, 12rpx) var(--sp-24, 24rpx) calc(var(--sp-20, 20rpx) + env(safe-area-inset-bottom)); border-radius: var(--radius-card, 16rpx) var(--radius-card, 16rpx) 0 0; background: $surface; }
.jd-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-12, 12rpx); }
.jd-sheet-title { font-size: var(--fs-30, 30rpx); font-weight: 700; }
.jd-sheet-close { padding: 0 var(--sp-8, 8rpx); color: $muted; font-size: 40rpx; line-height: 1; }
.jd-danger { background: $danger; color: $surface; }
</style>
