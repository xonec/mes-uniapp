<template>
    <view class="vk-shell">
        <!-- P2 批 3：tab 壳页。开关 true 渲染 vk 组件，false 渲染旧内容；tabBar 不动。 -->
        <AttendancePage v-if="vkEnabled" :show-tick="vkShowTick" />
        <template v-else>
            <view class="fw-page op-page att-page">
        <view class="att-head">
            <view class="att-period">
                <button class="att-arrow" :disabled="busy" @tap="prevPeriod" aria-label="上一周期"><uni-icons type="back" size="16" color="#008577"></uni-icons></button>
                <picker mode="date" :fields="periodType" :value="calendarValue" :disabled="busy" @change="changePeriod">
                    <view class="att-period-value">{{ periodLabel }}<view class="period-caret"><uni-icons type="bottom" size="10" color="#5F6A65"></uni-icons></view></view>
                </picker>
                <button class="att-arrow" :disabled="busy" @tap="nextPeriod" aria-label="下一周期"><uni-icons type="forward" size="16" color="#008577"></uni-icons></button>
            </view>
            <view class="att-head-right">
                <view class="att-seg">
                    <button class="att-seg-item" :class="{ active: periodType === 'month' }" :disabled="busy" @tap="setPeriodType('month')">月</button>
                    <button class="att-seg-item" :class="{ active: periodType === 'year' }" :disabled="busy" @tap="setPeriodType('year')">年</button>
                </view>
                <button class="att-help" @tap="helpOpen = !helpOpen" aria-label="考勤口径">?</button>
            </view>
        </view>
        <view v-if="helpOpen" class="att-help-card">
            <text class="att-help-text">按生产日统计：八小时夜班归属前一天；多道工序共用一段时间时，工时只计一次。</text>
        </view>

        <view v-if="error" class="fw-notice error">{{ error }}</view>

        <view v-if="hasData" class="fw-card att-overview">
            <view class="att-metrics">
                <view class="att-metric"><text class="att-metric-value">{{ overview.attendanceDays }}</text><text class="att-metric-label">出勤天数</text></view>
                <view class="att-metric"><text class="att-metric-value">{{ overview.hours }}</text><text class="att-metric-label">总工时</text></view>
                <view class="att-metric"><text class="att-metric-value">{{ overview.restDays }}</text><text class="att-metric-label">休息天数</text></view>
                <view class="att-metric"><text class="att-metric-value">{{ overview.leaveDays }}</text><text class="att-metric-label">请假天数</text></view>
            </view>
            <view class="att-rate"><view class="att-rate-head"><text>出勤率</text><text class="att-rate-value">{{ overview.rate }}%</text></view><view class="att-rate-track"><view class="att-rate-bar" :style="{ width: overview.rate + '%' }" /></view></view>
            <view v-if="overview.processes.length" class="att-processes">
                <view v-for="item in overview.processes" :key="item.name" class="att-process">
                    <text class="att-process-name">{{ item.name }}</text>
                    <view class="att-process-track"><view class="att-process-bar" :style="{ width: item.width + '%' }" /></view>
                    <text class="att-process-count">{{ item.count }}</text>
                </view>
            </view>
        </view>

        <view v-if="conflicts.length" class="att-conflicts">
            <view v-for="row in conflicts" :key="row._id" class="fw-card att-conflict">
                <view class="att-conflict-head"><text class="att-conflict-title">{{ row.date }} · 排班已更新</text><text class="att-tag warn">待核对</text></view>
                <text class="att-conflict-line">新排班：{{ summaryLabel(row.conflict.incoming) }}</text>
                <text class="att-conflict-line">本人记录：{{ summaryLabel(row.conflict.retained) }}</text>
                <text class="att-conflict-note">排班已更新，与我的记录不一致，请联系管理员处理。</text>
            </view>
        </view>

        <StateView v-if="loading && !rows.length" state="loading" />
        <view v-for="group in dayGroups" :key="group.date" class="fw-card att-day">
            <view class="att-day-head">
                <text class="att-day-date">{{ group.date }}</text>
                <text class="att-day-week">周{{ group.weekday }}</text>
                <view class="att-day-badges"><text v-for="status in group.statuses" :key="status" class="att-tag" :class="status">{{ statusLabel(status) }}</text></view>
            </view>
            <view v-for="row in group.rows" :key="row._id" class="att-row">
                <view class="att-row-main">
                    <view class="att-row-line">
                        <text class="att-title">{{ row.kind === 'rest' ? statusLabel(row.absenceType === 'leave' ? 'leave' : 'rest') : shiftLabel(row.shiftName) + (row.processNames && row.processNames.length ? ' · ' + row.processNames.join('、') : '') }}</text>
                        <text v-if="row.kind !== 'rest'" class="att-hours">{{ hoursLabel(row.workHours) }}</text>
                    </view>
                    <view v-if="row.kind !== 'rest'" class="att-row-meta"><text>{{ timeRange(row) }}</text></view>
                    <view class="att-row-badges">
                        <text class="att-tag light">{{ row.source === 'schedule' ? '排班' : '手填' }}</text>
                        <text v-if="row.edited" class="att-tag light">已改</text>
                        <text v-if="row.conflict" class="att-tag warn">待核对</text>
                    </view>
                    <text v-if="noteText(row)" class="att-note">{{ noteText(row) }}</text>
                </view>
            </view>
        </view>
        <StateView v-if="!rows.length && !loading && !error" state="empty" title="该周期没有考勤记录" reason="本周期还没有排班或考勤记录；如已上班请联系管理员核对" />
        <view v-if="total > pageSize" class="att-pager">
            <button class="att-pager-btn" :disabled="busy || page <= 1" @tap="changePage(-1)">上一页</button>
            <text class="att-pager-text">{{ page }} / {{ Math.ceil(total / pageSize) }}</text>
            <button class="att-pager-btn" :disabled="busy || page * pageSize >= total" @tap="changePage(1)">下一页</button>
        </view>
            </view>
        </template>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationDate, loadBootstrap } from '@/utils/operations-api.js'
import { PAGE_SWITCH } from '@/utils/vk-migration.js'
import AttendancePage from '@/components/vk/pages/AttendancePage.vue'
import StateView from '@/components/ui/StateView.vue'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const STATUS_LABELS = { work: '出勤', rest: '休息', leave: '请假' }
/** 班次档案名自带「（8小时）」后缀，时长已在右侧单独显示，标题里去掉避免重复。 */
const SHIFT_HOURS = /\s*[（(]\s*\d+(?:\.\d+)?\s*(?:小时|h|H)\s*[）)]\s*$/
/** 后台导入完整日表时写进 schedule.note 的系统文案，不是员工备注，不展示。 */
const SYSTEM_NOTES = ['完整日表未列出，默认休息', '完整日表自动补齐休息', '当天未列出，默认休息']
function isSystemNote(line) { return SYSTEM_NOTES.includes(line) || /完整日表.*默认休息/.test(line) }

function pad(value) { return String(value).padStart(2, '0') }
function parseDate(date) { const [year, month, day] = String(date || '').split('-').map(Number); return new Date(year, (month || 1) - 1, day || 1) }
function monthOf(period) { return String(period || operationDate()).slice(0, 7) }
function shiftMonth(period, delta) {
    const [year, month] = monthOf(period).split('-').map(Number)
    const target = new Date(year, month - 1 + delta, 1)
    return target.getFullYear() + '-' + pad(target.getMonth() + 1)
}

export default {
    components: { StateView, AttendancePage },
    mixins: [operationsPage],
    data() {
        return {
            /** tab 壳开关：true = vk 组件，false = 旧内容（默认关） */
            vkEnabled: PAGE_SWITCH['operations.attendance'],
            vkShowTick: 0,
            vkFirstShow: true,
            periodType: 'month',
            period: operationDate().slice(0, 7),
            lastMonth: operationDate().slice(5, 7),
            page: 1,
            pageSize: 20,
            total: 0,
            rows: [],
            summary: null,
            helpOpen: false
        }
    },
    computed: {
        busy() { return this.loading },
        calendarValue() { return this.periodType === 'year' ? this.period + '-01-01' : monthOf(this.period) + '-01' },
        periodLabel() { return this.periodType === 'year' ? this.period + '年' : this.period.slice(0, 4) + '年' + Number(this.period.slice(5, 7)) + '月' },
        dayGroups() {
            const groups = new Map()
            for (const row of this.rows) {
                if (!groups.has(row.date)) groups.set(row.date, { date: row.date, weekday: WEEKDAYS[parseDate(row.date).getDay()], rows: [] })
                groups.get(row.date).rows.push(row)
            }
            return [...groups.values()].map(group => ({ ...group, statuses: [...new Set(group.rows.map(row => this.statusOf(row)))] }))
        },
        overview() {
            const attendanceDays = Number((this.summary && this.summary.attendanceDays) || 0)
            const hours = Math.round(Number((this.summary && this.summary.workHours) || 0) * 100) / 100
            const restDays = Number((this.summary && this.summary.restDays) || 0)
            const leaveDays = Number((this.summary && this.summary.leaveDays) || 0)
            const total = attendanceDays + restDays + leaveDays
            const processRows = (this.summary && this.summary.processes) || []
            const max = processRows.reduce((value, item) => Math.max(value, Number(item.count) || 0), 0) || 1
            return {
                attendanceDays,
                hours,
                restDays,
                leaveDays,
                rate: total ? Math.round(attendanceDays / total * 100) : 0,
                processes: processRows.map(item => ({ name: item.name, count: item.count, width: Math.round((Number(item.count) || 0) / max * 100) }))
            }
        },
        conflicts() { return this.rows.filter(row => row.conflict) },
        /** 本周期完全没有记录时隐藏全 0 概览，只留空态，避免四个 0 + 空进度条占屏。 */
        hasData() { const value = this.overview; return !!(this.total || value.attendanceDays || value.hours || value.restDays || value.leaveDays || value.processes.length) }
    },
    onShow() {
        if (this.vkEnabled) {
            // 首屏由组件 mounted 取数；之后每次进入 tab 通过 tick 触发刷新
            if (this.vkFirstShow) { this.vkFirstShow = false; return }
            this.vkShowTick += 1
            return
        }
        this.load()
    },
    methods: {
        /** 只读页面：列表与概览都只取数，不提供任何写操作。 */
        load() {
            const query = { periodType: this.periodType, period: this.period }
            return loadOperations(this, async () => {
                await loadBootstrap()
                const result = await callOperations('myAttendance', { ...query, page: this.page, pageSize: this.pageSize })
                const summary = await callOperations('attendanceSummary', { ...query, own: true })
                return [result, summary]
            }, ([result, summary]) => {
                this.rows = result.list || []
                this.total = result.total || 0
                this.summary = summary || null
            })
        },
        clearLoaded() { this.rows = []; this.summary = null; this.total = 0 },
        changePeriod(event) { if (this.busy) return; this.period = event.detail.value.slice(0, this.periodType === 'year' ? 4 : 7); this.page = 1; this.load() },
        setPeriodType(type) {
            if (this.busy || type === this.periodType) return
            if (type === 'year') { this.lastMonth = monthOf(this.period).slice(5, 7); this.period = this.period.slice(0, 4) }
            else this.period = this.period.slice(0, 4) + '-' + this.lastMonth
            this.periodType = type; this.page = 1; this.load()
        },
        prevPeriod() { this.shiftPeriod(-1) },
        nextPeriod() { this.shiftPeriod(1) },
        shiftPeriod(delta) {
            if (this.busy) return
            const step = Number(delta)
            if (!Number.isFinite(step) || !step) return
            if (this.periodType === 'year') this.period = String(Number(this.period) + step)
            else this.period = shiftMonth(this.period, step)
            this.page = 1; this.load()
        },
        changePage(step) { if (!this.busy) { this.page += step; this.load() } },
        statusOf(row) { return row.kind === 'rest' ? (row.absenceType === 'leave' ? 'leave' : 'rest') : 'work' },
        statusLabel(status) { return STATUS_LABELS[status] || '出勤' },
        hoursLabel(hours) { return (Math.round(Number(hours || 0) * 100) / 100) + 'h' },
        shiftLabel(name) { return String(name || '').replace(SHIFT_HOURS, '').trim() || '未填班次' },
        noteText(row) {
            // 只展示手填备注；排班同步来的 note 是导入端的人员安排文本，既重复又可能串人。
            if (!row || row.source !== 'manual') return ''
            return String(row.note || '').split('\n').map(line => line.trim()).filter(line => line && !isSystemNote(line)).join('\n')
        },
        timeRange(row) {
            if (!row.startTime) return '时间未记录'
            const start = (Number(row.startDayOffset) ? '次日 ' : '') + row.startTime
            const end = (Number(row.endDayOffset) > Number(row.startDayOffset) ? '次日 ' : '') + row.endTime
            return start + '–' + end
        },
        summaryLabel(record) {
            if (!record) return '无记录'
            if ((record.kind || 'work') === 'rest') return (record.absenceType === 'leave' ? '请假' : '休息')
            const names = record.processNames || []
            return this.shiftLabel(record.shiftName) + (names.length ? ' · ' + names.join('、') : '') + ' · ' + this.timeRange(record)
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.att-page { padding-bottom: calc(32rpx + env(safe-area-inset-bottom)); }
.att-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }
.att-period { display: flex; align-items: center; min-width: 0; }
.att-arrow { margin: 0 6rpx 0 0; padding: 0; width: 56rpx; height: 56rpx; display: flex; align-items: center; justify-content: center; border-radius: 12rpx; background: $canvas; }
.att-arrow::after { border: 0; }
.att-period-value { display: flex; align-items: center; font-size: 30rpx; font-weight: 700; padding: 0 6rpx; }
.period-caret { display: flex; align-items: center; margin-left: 4rpx; }
.att-head-right { display: flex; align-items: center; flex-shrink: 0; margin-left: 12rpx; }
.att-seg { margin-right: 12rpx; }
.att-seg { display: flex; padding: 4rpx; border-radius: 12rpx; background: $canvas; }
.att-seg-item { margin: 0; padding: 0 12rpx; min-height: 48rpx; line-height: 48rpx; font-size: 24rpx; border-radius: 8rpx; background: transparent; color: $muted; }
.att-seg-item::after { border: 0; }
.att-seg-item.active { background: $surface; color: $primary; font-weight: 600; }
.att-help { margin: 0; padding: 0; width: 48rpx; height: 48rpx; line-height: 48rpx; text-align: center; border-radius: 50%; background: $canvas; color: $muted; font-size: 26rpx; }
.att-help::after { border: 0; }
.att-help-card { padding: 20rpx 16rpx; margin-bottom: 20rpx; border-radius: 16rpx; background: $primary-soft; }
.att-help-text { font-size: 24rpx; color: $ink; line-height: 1.6; }
.att-overview { padding: 16rpx; }
.att-metrics { display: flex; margin-right: -12rpx; }
.att-metric { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; margin-right: 12rpx; }
.att-metric-value { font-size: 36rpx; font-weight: 700; }
.att-metric-label { margin-top: 4rpx; font-size: 22rpx; color: $muted; }
.att-rate { margin-top: 20rpx; }
.att-rate-head { display: flex; align-items: center; justify-content: space-between; font-size: 24rpx; color: $muted; margin-bottom: 6rpx; }
.att-rate-value { color: $primary; font-weight: 700; }
.att-rate-track { height: 12rpx; border-radius: 999rpx; background: $canvas; overflow: hidden; }
.att-rate-bar { height: 100%; border-radius: 999rpx; background: $primary; }
.att-processes { margin-top: 12rpx; margin-bottom: -6rpx; display: flex; flex-direction: column; }
.att-process { display: flex; align-items: center; margin-bottom: 6rpx; }
.att-process-name { width: 160rpx; font-size: 22rpx; color: $muted; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.att-process-track { flex: 1; height: 10rpx; margin: 0 12rpx; border-radius: 999rpx; background: $canvas; overflow: hidden; }
.att-process-bar { height: 100%; border-radius: 999rpx; background: $primary; opacity: .7; }
.att-process-count { width: 48rpx; text-align: right; font-size: 22rpx; color: $muted; }
.att-conflicts { display: flex; flex-direction: column; margin-bottom: 0; }
.att-conflict { margin-bottom: 12rpx; padding: 20rpx; border-left: 6rpx solid $warning; }
.att-conflict-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6rpx; }
.att-conflict-title { font-size: 28rpx; font-weight: 700; }
.att-conflict-line { display: block; font-size: 24rpx; color: $muted; line-height: 1.5; }
.att-conflict-note { display: block; font-size: 22rpx; color: $warning; margin-top: 6rpx; }
.att-day { padding: 20rpx 16rpx; }
.att-day-head { display: flex; align-items: center; padding-bottom: 12rpx; border-bottom: 1rpx solid $line; }
.att-day-date { font-size: 30rpx; font-weight: 700; }
.att-day-week { margin-left: 12rpx; font-size: 22rpx; color: $muted; }
.att-day-badges { margin-left: auto; display: flex; }
.att-day-badges .att-tag + .att-tag, .att-row-badges .att-tag { margin-left: 6rpx; margin-bottom: 6rpx; }
.att-row { padding: 12rpx 0; border-bottom: 1rpx solid $line; }
.att-row:last-child { border-bottom: 0; }
.att-row-main { min-width: 0; }
.att-row-line { display: flex; align-items: baseline; justify-content: space-between; }
.att-title { font-size: 28rpx; font-weight: 600; }
.att-hours { flex-shrink: 0; font-size: 26rpx; font-weight: 700; color: $primary; }
.att-row-meta { display: block; font-size: 22rpx; color: $muted; margin-top: 4rpx; }
.att-row-badges { display: flex; flex-wrap: wrap; margin: 6rpx 0 -6rpx; }
.att-note { display: block; font-size: 20rpx; color: $muted; line-height: 1.5; margin-top: 6rpx; opacity: .85; }
.att-tag { display: inline-block; padding: 2rpx 12rpx; border-radius: 8rpx; font-size: 20rpx; background: $canvas; color: $muted; }
.att-tag.work { background: $primary-soft; color: $primary; }
.att-tag.leave { background: mix($warning, $surface, 15%); color: $warning; }
.att-tag.rest { background: $canvas; color: $muted; }
.att-tag.warn { background: mix($warning, $surface, 15%); color: $warning; }
.att-tag.light { background: $canvas; color: $muted; }
.att-pager { display: flex; align-items: center; justify-content: center; padding: 20rpx 0 6rpx; }
.att-pager-text { margin: 0 16rpx; }
.att-pager-btn { margin: 0; min-height: 64rpx; line-height: 64rpx; padding: 0 16rpx; font-size: 24rpx; border-radius: 12rpx; background: $canvas; color: $primary; }
.att-pager-btn::after { border: 0; }
.att-pager-btn[disabled] { color: $muted; opacity: .5; }
.att-pager-text { font-size: 24rpx; color: $muted; }
</style>
