<template>
    <view class="fw-page op-page"><view class="fw-header"><text class="fw-subtitle">{{ states[record.status || 'draft'] }} · {{ record.authorName || '当前账号填写' }}</text></view><view v-if="error" class="fw-notice error">{{ error }}</view><button v-if="record._id" class="fw-button secondary" :disabled="saving || loading" @tap="load">重新加载</button>
        <view v-if="ready" class="fw-card"><view class="fw-field"><text class="fw-label">交班日期（本班开始日）*</text><picker mode="date" :value="record.date" :disabled="readOnly" @change="record.date = $event.detail.value"><view class="fw-input">{{ record.date }}</view></picker></view><ops-select v-model="record.processId" label="工序 *" :items="processes" :disabled="readOnly" /><ops-select v-model="record.shiftId" label="交班班次 *" :items="catalogs.shifts || []" :disabled="readOnly" /><view class="fw-field"><text class="fw-label">接班日期 *</text><picker mode="date" :value="record.nextDate" :disabled="readOnly" @change="record.nextDate = $event.detail.value"><view class="fw-input">{{ record.nextDate }}</view></picker></view><ops-select v-model="record.nextShiftId" label="接班班次 *" :items="catalogs.shifts || []" :disabled="readOnly" /><ops-select v-model="record.receiverId" label="指定接班人 *" :items="receivers" :disabled="readOnly" />
            <template v-if="!readOnly"><view class="fw-field"><text class="fw-label">按完整批号查找在制工单</text><input v-model="jobKeyword" class="fw-input" maxlength="12" placeholder="完整批号（含 B 单后缀）" /></view><button class="fw-button secondary" :disabled="finding" @tap="findJobs">{{ finding ? '查询中…' : '查找工单' }}</button><view class="op-chips"><text v-for="job in jobChoices" :key="job._id" class="op-chip" :class="{ selected: record.jobIds.includes(job._id) }" @tap="toggleJob(job._id)">{{ job.batchNo }} · {{ job.processName }}</text></view></template>
            <text class="op-meta">已关联 {{ record.jobIds.length }} 个工单</text><view v-for="snap in record.jobSnapshots || []" :key="snap._id" class="op-meta">{{ snap.batchNo }} · {{ snap.processName }} · V{{ snap.version }}</view>
            <view class="fw-field"><text class="fw-label">岗位分工 / 在制批次 / 本班完成情况 *</text><textarea v-model="record.content" class="fw-textarea" maxlength="4000" :disabled="readOnly" placeholder="说明各岗位、本班轮换及需要下班继续的事项" /></view><view class="fw-field"><text class="fw-label">末托及零头处理</text><textarea v-model="record.tailPallet" class="fw-textarea" maxlength="2000" :disabled="readOnly" /></view><view class="fw-field"><text class="fw-label">设备及卫生状态</text><textarea v-model="record.hygiene" class="fw-textarea" maxlength="2000" :disabled="readOnly" /></view><view class="fw-field"><text class="fw-label">异常及待办交接</text><textarea v-model="record.exceptions" class="fw-textarea" maxlength="2000" :disabled="readOnly" /></view><view v-if="record._id && !readOnly" class="fw-field"><text class="fw-label">修改原因 *</text><input v-model="record.changeReason" class="fw-input" maxlength="1000" /></view>
            <view v-if="!readOnly" class="fw-actions"><button class="fw-button primary" :disabled="saving" @tap="save">保存草稿</button><button v-if="record._id && !dirty" class="fw-button" :disabled="saving" @tap="changeState('submit')">提交交班</button></view><text v-if="dirty && record._id && !readOnly" class="op-meta">修改内容后请先保存，再提交交班。</text>
            <view v-if="canReceive"><view class="fw-field"><text class="fw-label">接班核对说明 *</text><textarea v-model="receiveNote" class="fw-textarea" maxlength="1000" :disabled="saving" /></view><button class="fw-button primary" :disabled="saving" @tap="changeState('receive')">本人确认接班</button></view><text v-if="record.status === 'received'" class="op-meta">已由 {{ record.receivedByName || record.receiverName }} 于 {{ time(record.receivedAt) }} 确认接班。{{ record.receiveNote || '' }}</text>
        </view>
    </view>
</template>
<script>
import OpsSelect from '@/components/operations/OpsSelect.vue'
import { getUser } from '@/utils/auth.js'
import { batchIsValid } from '@/utils/shared/batch.js'
import { callOperations, operationsPage, loadOperations, operationDate, operationRequest, HANDOVER_STATES } from '@/utils/operations-api.js'
const fresh = () => ({ date: operationDate(), nextDate: operationDate(), shiftId: '', nextShiftId: '', processId: '', receiverId: '', jobIds: [], content: '', tailPallet: '', hygiene: '', exceptions: '', changeReason: '' })
const contentKey = row => JSON.stringify(['date','nextDate','shiftId','nextShiftId','processId','receiverId','jobIds','content','tailPallet','hygiene','exceptions'].map(key => row[key]))
export default {
    components: { OpsSelect }, mixins: [operationsPage], data() { return { id: '', record: fresh(), savedKey: '', ready: false, catalogs: {}, profile: {}, receiveNote: '', jobKeyword: '', jobChoices: [], finding: false, states: HANDOVER_STATES } },
    computed: {
        dirty() { return contentKey(this.record) !== this.savedKey },
        readOnly() { return this.saving || this.loading || this.record.status && this.record.status !== 'draft' || this.record._id && this.record.authorId !== (getUser() || {}).uid },
        canReceive() { return this.record.status === 'submitted' && this.profile.personId === this.record.receiverId && this.record.authorId !== (getUser() || {}).uid },
        workshopId() { const process = (this.catalogs.processes || []).find(row => row._id === this.record.processId); return process ? process.workshopId : this.record.workshopId || this.profile.workshopId || '' },
        processes() { return (this.catalogs.processes || []).filter(row => this.profile.isAdmin || row.workshopId === this.profile.workshopId) },
        receivers() { return (this.catalogs.personnel || []).filter(row => (row.uid || row.accountBound) && !row.isSelf && row.uid !== (getUser() || {}).uid && row.workshopId === this.workshopId && (row.processIds || []).includes(this.record.processId)) }
    },
    onLoad(options) { this.id = options.id || ''; const row = uni.getStorageSync('mes:handover-view'); uni.removeStorageSync('mes:handover-view'); if (row && row._id === this.id) this.record = { ...fresh(), ...row }; this.syncNavTitle() }, onShow() { this.load() },
    methods: {
        /** 动态标题交给原生导航栏，页内不再重复画。 */
        syncNavTitle() { uni.setNavigationBarTitle({ title: this.record._id ? '交班单' : '填写交班单' }) },
        load() { return loadOperations(this, async () => { const base = await callOperations('bootstrap'); const row = this.id ? await callOperations('getHandover', { id: this.id }) : null; return { base, row } }, ({ base, row }) => { this.profile = base.profile; this.catalogs = base.catalogs; if (row) this.record = { ...fresh(), ...row }; this.savedKey = contentKey(this.record); this.ready = true; this.syncNavTitle() }) },
        clearLoaded() { this.ready = false }, time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' },
        toggleJob(id) { const ids = this.record.jobIds; this.record.jobIds = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] },
        async findJobs() { if (this.finding) return; if (!batchIsValid(this.jobKeyword.toUpperCase())) { this.error = '请输入完整批号（含 B 单后缀）'; return }; this.finding = true; try { const result = await callOperations('listJobs', { keyword: this.jobKeyword.toUpperCase(), pageSize: 50 }); this.jobChoices = result.list.filter(row => row.batchNo === this.jobKeyword.toUpperCase() && row.processId === this.record.processId); if (!this.jobChoices.length) this.error = '此批号没有与所选工序匹配的工单' } catch (error) { this.error = error.message } finally { this.finding = false } },
        async save() {
            if (this.readOnly) return; this.saving = true; this.error = ''
            try { const record = Object.fromEntries(['_id','date','nextDate','shiftId','nextShiftId','processId','receiverId','jobIds','content','tailPallet','hygiene','exceptions','changeReason'].map(key => [key, this.record[key]])); const requestId = operationRequest(this, 'saveHandover', record); this.record = { ...fresh(), ...await callOperations('saveHandover', { record, expectedVersion: this.record.version || 0, requestId }) }; this.id = this.record._id; this.savedKey = contentKey(this.record); this.syncNavTitle(); this.pendingRequest = null; uni.showToast({ title: '草稿已保存', icon: 'success' }) }
            catch (error) { this.error = error.message } finally { this.saving = false }
        },
        async changeState(command) {
            if (this.saving || this.loading || command === 'submit' && this.dirty) return
            if (command === 'receive' && !this.receiveNote.trim()) { this.error = '请填写接班核对说明'; return }
            this.saving = true; this.error = ''
            try { const payload = { note: command === 'receive' ? this.receiveNote : '核对后提交交班' }; this.record = { ...fresh(), ...await callOperations('handoverCommand', { id: this.id, expectedVersion: this.record.version, requestId: operationRequest(this, command, payload), command, ...payload }) }; this.savedKey = contentKey(this.record); this.pendingRequest = null; uni.showToast({ title: command === 'receive' ? '已接班' : '已提交', icon: 'success' }) } catch (error) { this.error = error.message } finally { this.saving = false }
        }
    }
}
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
