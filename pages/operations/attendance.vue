<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">排班自动形成考勤记录，可按实际情况修改并保存；八小时夜班归属前一天的生产日。</text></view>
        <view class="op-chips"><button v-for="type in periodTypes" :key="type.value" class="op-chip" :class="{ selected: periodType === type.value }" :disabled="busy" @tap="changePeriodType(type.value)">{{ type.name }}</button></view>
        <view class="op-toolbar"><picker mode="date" :fields="periodType" :value="calendarValue" :disabled="busy" @change="changePeriod"><view class="fw-button secondary">{{ period }} ▾</view></picker><button class="fw-button" :disabled="busy" @tap="refresh">刷新</button><button class="fw-button primary" :disabled="busy || !profile.personId" @tap="edit()">新增记录</button></view>
        <view v-if="error" class="fw-notice error">{{ error }}</view><view v-if="notice" class="fw-notice">{{ notice }}</view>
        <view v-if="summary" class="fw-card"><text class="op-name">{{ personName }} · {{ period }}</text><view class="op-grid"><view><text class="op-number">{{ summary.attendanceDays || 0 }}</text><text class="op-meta">出勤天数</text></view><view><text class="op-number">{{ summary.workHours || 0 }}</text><text class="op-meta">总工时（小时）</text></view><view><text class="op-number">{{ participationCount }}</text><text class="op-meta">工序参与次数</text></view></view><text v-for="item in summary.processes" :key="item.processId" class="op-meta">{{ item.name }} · {{ item.count }} 次</text><text class="fw-note">按完整自然月／年统计，含未来排班；多道工序共用一段时间，工时只计一次。</text><text v-if="summary.conflictCount" class="fw-note">有 {{ summary.conflictCount }} 条排班更新待选择保留内容。</text></view>
        <view v-if="editing" class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">{{ editing._id ? '修改考勤记录' : '新增考勤记录' }}</text></view>
            <picker mode="date" :value="form.date" :disabled="busy || editing.source === 'schedule'" @change="form.date = $event.detail.value"><view class="fw-input">生产日：{{ form.date }}{{ editing.source === 'schedule' ? '（来自排班）' : ' ▾' }}</view></picker>
            <view class="op-chips"><button v-for="kind in kinds" :key="kind.value" class="op-chip" :class="{ selected: form.kind === kind.value }" :disabled="busy" @tap="form.kind = kind.value">{{ kind.name }}</button></view>
            <view v-if="form.kind === 'rest'" class="op-chips"><button class="op-chip" :class="{ selected: form.absenceType !== 'leave' }" :disabled="busy" @tap="form.absenceType = 'rest'">休息</button><button class="op-chip" :class="{ selected: form.absenceType === 'leave' }" :disabled="busy" @tap="form.absenceType = 'leave'">请假</button></view>
            <template v-if="form.kind === 'work'">
                <ops-select :value="form.shiftId" label="实际班次 *" :items="catalogs.shifts || []" :disabled="busy" @input="changeShift" />
                <text class="fw-label">参与工序（可多选）*</text><view class="op-chips"><button v-for="item in processes" :key="item._id" class="op-chip" :class="{ selected: form.processIds.includes(item._id) }" :disabled="busy" @tap="toggleProcess(item._id)">{{ form.processIds.includes(item._id) ? '✓ ' : '' }}{{ item.name }}</button></view><text v-if="!processes.length" class="fw-note">所在车间暂无启用工序，请联系管理员维护。</text>
                <view v-for="item in timeFields" :key="item.time" class="fw-field"><text class="fw-label">{{ item.label }} *</text><view class="op-toolbar"><picker :range="dayNames" :value="form[item.day]" :disabled="busy" @change="setOffset(item.day, $event)"><view class="fw-input">{{ dayNames[form[item.day]] }} ▾</view></picker><picker mode="time" :value="form[item.time]" :disabled="busy" @change="setTime(item.time, $event)"><view class="fw-input">{{ form[item.time] || '选择时间' }} ▾</view></picker></view></view>
            </template>
            <text class="op-meta">本条工时：{{ form.kind === 'rest' ? 0 : selectedHours }} 小时，不扣休息时间。</text>
            <view class="fw-field"><text class="fw-label">{{ profile.isAdmin && editing._id ? '管理员修改原因 *' : '修改原因（可选）' }}</text><textarea v-model="form.changeReason" class="fw-textarea" :disabled="busy" maxlength="1000" /></view>
            <view class="fw-field"><text class="fw-label">备注（可选）</text><textarea v-model="form.note" class="fw-textarea" :disabled="busy" maxlength="1000" /></view>
            <view class="op-toolbar"><button class="fw-button secondary" :disabled="busy" @tap="editing = null">取消</button><button class="fw-button primary" :disabled="busy" @tap="save">{{ saving ? '保存中…' : '保存记录' }}</button></view>
        </view>
        <view v-if="loading" class="fw-card fw-empty">正在读取考勤记录…</view>
        <view v-for="row in rows" :key="row._id" class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">{{ row.date }}</text><text class="fw-badge">{{ row.kind === 'rest' ? absenceLabel(row) : '出勤' }}</text></view>
            <text class="op-name">{{ recordLabel(row) }}</text><text class="op-meta">{{ row.workHours || 0 }} 小时 · {{ row.source === 'schedule' ? '排班预设' : '自行记录' }}{{ row.edited ? ' · 已修改' : '' }}</text><text v-if="row.note" class="op-pre">{{ row.note }}</text>
            <view v-if="row.conflict" class="fw-notice"><text class="op-name">排班已更新，请选择保留内容</text><text class="op-meta">新排班：{{ recordLabel(row.conflict.incoming) }}</text><text class="op-meta">我的修改：{{ recordLabel(row.conflict.retained) }}</text><view class="op-toolbar"><button class="fw-button secondary" :disabled="busy" @tap="resolveConflict(row, 'retained')">保留我的修改</button><button class="fw-button primary" :disabled="busy" @tap="resolveConflict(row, 'schedule')">采用新排班</button></view></view>
            <text v-if="row.scheduleRemoved && !row.conflict" class="fw-note">新排班已移除此班次，记为休息，历史修改仍可查看。</text>
            <view class="op-toolbar"><button class="fw-button secondary" :disabled="busy || !!row.conflict" @tap="edit(row)">修改记录</button><button class="fw-button secondary" :disabled="busy" @tap="showHistory(row)">修改历史</button></view>
        </view>
        <view v-if="!rows.length && !loading && !error" class="fw-card fw-empty"><text class="fw-empty-title">该周期暂无考勤记录</text><text class="fw-note">导入排班后自动生成，也可以自行新增记录。账号需先绑定人员档案。</text></view>
        <view v-if="total > pageSize" class="op-toolbar"><button class="fw-button secondary" :disabled="busy || page <= 1" @tap="changePage(-1)">上一页</button><text>{{ page }} / {{ Math.ceil(total / pageSize) }}</text><button class="fw-button secondary" :disabled="busy || page * pageSize >= total" @tap="changePage(1)">下一页</button></view>
        <view v-if="historyRows.length" class="fw-card"><view class="fw-heading"><text class="fw-heading-title">修改历史</text><text class="fw-link" @tap="historyRows = []">收起</text></view><view v-for="record in historyRows" :key="record.version" class="op-row"><view><text class="op-name">V{{ record.version }} · {{ recordLabel(record) }}</text><text class="op-meta">{{ record.workHours || 0 }} 小时 · {{ record.audit && record.audit.actorName }} · {{ stamp(record.audit && record.audit.at) }}</text><text class="op-pre">{{ record.audit && record.audit.reason }}{{ record.note ? '\n备注：' + record.note : '' }}</text></view></view></view>
    </view>
</template>
<script>
import OpsSelect from '@/components/operations/OpsSelect.vue'
import { callOperations, operationsPage, loadOperations, operationDate, operationRequest } from '@/utils/operations-api.js'
/** 一段实际时间对应多道工序，不拆分或重复计算工时。 */
function blank() { return { date: operationDate(), kind: 'work', shiftId: '', processIds: [], startTime: '', endTime: '', startDayOffset: 0, endDayOffset: 0, note: '', changeReason: '' } }
export default {
    components: { OpsSelect }, mixins: [operationsPage],
    data() { return { periodType: 'month', period: operationDate().slice(0, 7), lastMonth: operationDate().slice(5, 7), periodTypes: [{ value: 'month', name: '按月' }, { value: 'year', name: '按年' }], kinds: [{ value: 'work', name: '出勤' }, { value: 'rest', name: '休息' }], dayNames: ['当天', '次日'], timeFields: [{ time: 'startTime', day: 'startDayOffset', label: '实际上班时间' }, { time: 'endTime', day: 'endDayOffset', label: '实际下班时间' }], page: 1, pageSize: 20, total: 0, rows: [], summary: null, personName: '', catalogs: {}, profile: {}, editing: null, form: blank(), notice: '', historyRows: [], historyLoading: false } },
    computed: {
        busy() { return this.loading || this.saving || this.historyLoading },
        calendarValue() { return this.periodType === 'year' ? this.period + '-01-01' : this.period + '-01' },
        processes() { return (this.catalogs.processes || []).filter(row => row.enabled !== false && row.workshopId === this.profile.workshopId) },
        participationCount() { return (this.summary && this.summary.processes || []).reduce((sum, row) => sum + row.count, 0) },
        selectedHours() { if (![this.form.startTime, this.form.endTime].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ''))) return '请核对时间'; const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); const hours = (this.form.endDayOffset * 1440 + minutes(this.form.endTime) - this.form.startDayOffset * 1440 - minutes(this.form.startTime)) / 60; return hours > 0 && hours <= 24 ? Math.round(hours * 100) / 100 : '请核对时间' }
    },
    onShow() { if (!this.saving) this.load() },
    methods: {
        /** 本人列表和本人统计分别读取；主管登录个人页面也只显示本人。 */
        async load() { this.editing = null; this.historyRows = []; const query = { periodType: this.periodType, period: this.period }; return loadOperations(this, () => Promise.all([callOperations('bootstrap'), callOperations('myAttendance', { ...query, page: this.page, pageSize: this.pageSize }), callOperations('attendanceSummary', { ...query, own: true })]), ([base, result, summary]) => { this.catalogs = base.catalogs; this.profile = base.profile; this.rows = result.list || []; this.total = result.total || 0; this.summary = summary; this.personName = ((base.catalogs.personnel || []).find(row => row._id === base.profile.personId) || {}).name || '本人' }) },
        clearLoaded() { this.rows = []; this.summary = null; this.total = 0; this.profile = {}; this.catalogs = {} },
        refresh() { if (!this.busy) { this.page = 1; this.load() } },
        changePeriodType(type) { if (this.busy || type === this.periodType) return; if (type === 'year') { this.lastMonth = this.period.slice(5, 7); this.period = this.period.slice(0, 4) } else this.period += '-' + this.lastMonth; this.periodType = type; this.page = 1; this.notice = ''; this.load() },
        changePeriod(event) { if (this.busy) return; this.period = event.detail.value.slice(0, this.periodType === 'year' ? 4 : 7); this.page = 1; this.notice = ''; this.load() },
        changePage(step) { if (!this.busy) { this.page += step; this.load() } },
        name(type, id) { return ((this.catalogs[type] || []).find(row => row._id === id) || {}).name || '—' },
        absenceLabel(row) { return row && row.absenceType === 'leave' ? '请假' : '休息' },
        recordLabel(row) { if (!row) return '无记录'; if (row.kind === 'rest') return this.absenceLabel(row) + ' · 0 小时'; const names = row.processNames || (row.processIds || []).map(id => this.name('processes', id)); return (row.shiftName || this.name('shifts', row.shiftId)) + ' / ' + names.join('、') + ' · ' + this.timeLabel(row) },
        timeLabel(row) { if (!row.startTime) return '时间未记录'; return (row.startDayOffset ? '次日 ' : '当天 ') + row.startTime + '—' + (row.endDayOffset ? '次日 ' : '当天 ') + row.endTime },
        stamp(value) { if (!value) return '—'; const date = new Date(value); return operationDate(date) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') },
        edit(row) { if (this.busy) return; this.editing = row || {}; this.form = { ...blank(), ...(row ? JSON.parse(JSON.stringify(row)) : {}), changeReason: '' }; this.form.processIds = [...(this.form.processIds || [])]; this.error = ''; this.notice = ''; uni.pageScrollTo({ scrollTop: 0, duration: 200 }) },
        changeShift(id) { if (this.busy) return; this.form.shiftId = id; const shift = (this.catalogs.shifts || []).find(row => row._id === id); if (shift) Object.assign(this.form, { startTime: shift.startTime, endTime: shift.endTime, startDayOffset: Number(shift.startDayOffset) || 0, endDayOffset: shift.endDayOffset == null ? (shift.endTime <= shift.startTime ? 1 : 0) : Number(shift.endDayOffset) }) },
        toggleProcess(id) { if (this.busy) return; const selected = this.form.processIds; const index = selected.indexOf(id); if (index < 0) selected.push(id); else selected.splice(index, 1) },
        setOffset(key, event) { if (!this.busy) this.form[key] = Number(event.detail.value) },
        setTime(key, event) { if (!this.busy) this.form[key] = event.detail.value },
        /** 直接保存记录，沿用版本和同一请求编号防止重复写入。 */
        async save() {
            if (this.busy || !this.editing) return;
            if (this.form.kind === 'work' && (!this.form.shiftId || !this.form.processIds.length || typeof this.selectedHours !== 'number')) { this.error = '请选择实际班次、参与工序并核对实际时间'; return }
            if (this.profile.isAdmin && this.editing._id && !this.form.changeReason.trim()) { this.error = '管理员修改请填写原因'; return }
            const record = { date: this.form.date, kind: this.form.kind, absenceType: this.form.kind === 'rest' ? this.form.absenceType || 'rest' : '', shiftId: this.form.kind === 'rest' ? '' : this.form.shiftId, processIds: this.form.kind === 'rest' ? [] : [...this.form.processIds], startTime: this.form.startTime, endTime: this.form.endTime, startDayOffset: this.form.startDayOffset, endDayOffset: this.form.endDayOffset, note: this.form.note, changeReason: this.form.changeReason };
            if (this.editing._id) record._id = this.editing._id;
            const payload = { record, expectedVersion: this.editing.version || 0 };
            const requestId = operationRequest(this, 'saveAttendance', payload);
            this.saving = true; this.error = ''; this.notice = '';
            try { await callOperations('saveAttendance', { ...payload, requestId }); this.notice = '考勤记录已保存。'; this.page = 1; await this.load() }
            catch (error) { this.error = error.message + (error.code === 409 ? ' 请刷新后查看最新记录。' : '') }
            finally { this.saving = false }
        },
        /** 仅在新排班与已有修改冲突时选择整条内容，不设出勤审批。 */
        async resolveConflict(row, choice) { if (this.busy) return; const payload = { id: row._id, choice, expectedVersion: row.version }; const requestId = operationRequest(this, 'resolveAttendanceConflict', payload); this.saving = true; this.error = ''; this.notice = ''; try { await callOperations('resolveAttendanceConflict', { ...payload, requestId }); this.notice = choice === 'schedule' ? '已采用新排班。' : '已保留我的修改。'; await this.load() } catch (error) { this.error = error.message + (error.code === 409 ? ' 请刷新后查看最新记录。' : '') } finally { this.saving = false } },
        async showHistory(record) { if (this.busy) return; this.historyRows = []; this.historyLoading = true; this.error = ''; try { const result = await callOperations('attendanceHistory', { id: record._id }); this.historyRows = (result.versions || []).slice().sort((a, b) => b.version - a.version) } catch (error) { this.error = error.message } finally { this.historyLoading = false } }
    }
}
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
