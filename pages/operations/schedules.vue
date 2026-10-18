<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">日期为生产日；八小时夜班从次日零点开始。</text></view>

        <view class="fw-card cal-card">
            <view class="cal-top">
                <view class="cal-segmented">
                    <button class="cal-seg" :class="{ active: mode === 'week' }" @tap="switchMode('week')">周视图</button>
                    <button class="cal-seg" :class="{ active: mode === 'month' }" @tap="switchMode('month')">月视图</button>
                </view>
                <view class="cal-actions">
                    <button class="cal-none" :disabled="loading" @tap="goCurrent">{{ mode === 'week' ? '本周' : '本月' }}</button>
                    <button class="cal-nav" :disabled="loading" @tap="shiftPeriod(-1)" aria-label="上一周期">‹</button>
                    <button class="cal-nav" :disabled="loading" @tap="shiftPeriod(1)" aria-label="下一周期">›</button>
                </view>
            </view>
            <text class="cal-title">{{ periodTitle }}</text>
            <view class="cal-week"><text v-for="label in weekdays" :key="label" class="cal-weekday">{{ label }}</text></view>

            <view v-if="loading && !marksReady" class="cal-skeleton">
                <view v-for="row in 5" :key="row" class="cal-skeleton-row"><view v-for="cell in 7" :key="cell" class="cal-skeleton-cell" /></view>
                <text class="fw-note cal-skeleton-note">正在加载排班…</text>
            </view>

            <view v-else-if="mode === 'week'" class="week-row">
                <view v-for="cell in weekDays" :key="cell.key" class="week-cell"
                      :class="{ today: cell.today, selected: cell.date === selectedDate }"
                      @tap="selectDay(cell)">
                    <text class="week-day">{{ cell.day }}</text>
                    <text v-if="cell.summary && cell.summary.shifts.length" class="week-shift">{{ shiftMarker(cell.summary) }}</text>
                    <text v-else-if="cell.summary && cell.summary.rest" class="week-rest">休{{ cell.summary.rest }}</text>
                    <text v-else-if="cell.summary && cell.summary.leave" class="week-leave">假{{ cell.summary.leave }}</text>
                    <text v-if="cell.summary && cell.summary.mine" class="cal-mine-dot" aria-label="本人有排班"></text>
                </view>
            </view>

            <view v-else class="cal-grid">
                <view v-for="cell in monthCells" :key="cell.key" class="cal-cell"
                      :class="{ outside: cell.outside, today: cell.today, selected: cell.date === selectedDate, mine: cell.summary && cell.summary.mine }"
                      @tap="selectDay(cell)">
                    <text class="cal-day">{{ cell.day }}</text>
                    <text v-if="cell.summary && cell.summary.work" class="cal-count">{{ cell.summary.work }}人</text>
                    <text v-else-if="cell.summary && cell.summary.rest" class="cal-rest">休{{ cell.summary.rest }}</text>
                    <text v-else-if="cell.summary && cell.summary.leave" class="cal-leave">假{{ cell.summary.leave }}</text>
                    <text v-if="cell.summary && cell.summary.mine" class="cal-mine-dot" aria-label="本人有排班"></text>
                </view>
            </view>
            <text v-if="!loading && marksReady && !marks.length" class="fw-note cal-empty">{{ mode === 'week' ? '本周暂无排班。' : '本月暂无排班。' }}</text>
        </view>

        <view class="fw-card plan-card">
            <view class="fw-heading"><text class="fw-heading-title">当日安排</text><text class="fw-badge">登录隔离</text></view>
            <text class="op-meta">{{ selectedDateText }} · 只显示本人或有权限范围内的排班。</text>
            <view class="filter-row">
                <picker :range="processNames" :value="processIndex" :disabled="loadingDetail" @change="changeProcess">
                    <view class="fw-button secondary filter-button">{{ processNames[processIndex] }} ▾</view>
                </picker>
                <picker :range="shiftNames" :value="shiftIndex" :disabled="loadingDetail" @change="changeShift">
                    <view class="fw-button secondary filter-button">{{ shiftNames[shiftIndex] }} ▾</view>
                </picker>
            </view>
            <view class="chips">
                <text class="chip">{{ batchCount }} 个批号</text>
                <text class="chip">{{ personCount }} 人</text>
            </view>

            <view v-if="loadingDetail && !list.length" class="fw-note">正在加载当天安排…</view>
            <view class="plan-columns">
                <view class="plan-col">
                    <view class="plan-title"><text>具体批号</text><text>{{ batchCount }} 个</text></view>
                    <view v-for="row in batchRows" :key="row.batchNo" class="plan-row" @tap="openTrace(row.batchNo)">
                        <text class="plan-code">{{ row.batchNo }}</text>
                        <text class="op-meta">{{ row.detail }}</text>
                    </view>
                    <text v-if="!batchRows.length && !loadingDetail" class="op-meta">当天暂无批号。</text>
                    <text v-else-if="!batchRows.length" class="op-meta">加载中…</text>
                </view>
                <view class="plan-col">
                    <view class="plan-title"><text>人员与岗位</text><text>{{ personCount }} 人</text></view>
                    <view v-for="row in personRows" :key="row.key" class="plan-row">
                        <text class="plan-person">{{ row.name }}</text>
                        <text class="op-meta">{{ row.detail }}</text>
                    </view>
                    <text v-if="!personRows.length && !loadingDetail" class="op-meta">当天暂无排班人员。</text>
                    <text v-else-if="!personRows.length" class="op-meta">加载中…</text>
                </view>
            </view>
            <text v-if="filtersActive" class="fw-note">已按{{ processNames[processIndex] }}{{ shiftNames[shiftIndex] }}筛选；统计与两栏都随筛选变化。</text>
            <text v-if="detailTotal > list.length" class="fw-note">当天共 {{ detailTotal }} 条，仅显示前 {{ list.length }} 条；其余请在后台查看。</text>
        </view>

        <button class="fw-button secondary" @tap="goAttendance">查看我的考勤记录</button>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationDate, operationName } from '@/utils/operations-api.js'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MAX_DAY_ROWS = 250

function pad(value) { return String(value).padStart(2, '0') }
function keyOf(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) }
function dateOf(key) { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day) }
function addDays(key, days) { const date = dateOf(key); date.setDate(date.getDate() + days); return keyOf(date) }
function monthOf(key) { return key.slice(0, 7) }
function shiftMonthKey(key, delta) {
    const date = dateOf(key)
    const target = new Date(date.getFullYear(), date.getMonth() + delta, 1)
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    target.setDate(Math.min(date.getDate(), last))
    return keyOf(target)
}

export default {
    mixins: [operationsPage],
    data() {
        return {
            weekdays: WEEKDAYS,
            mode: 'week',
            today: operationDate(),
            selectedDate: operationDate(),
            marks: [],
            marksReady: false,
            list: [],
            catalogs: {},
            detailTotal: 0,
            detailEpoch: 0,
            loadingDetail: false,
            processIndex: 0,
            shiftIndex: 0
        }
    },
    computed: {
        markMap() { return new Map(this.marks.map(day => [day.date, day])) },
        weekStart() { const date = dateOf(this.selectedDate); return addDays(this.selectedDate, -date.getDay()) },
        weekDays() {
            const summary = this.markMap
            return Array.from({ length: 7 }, (_, index) => {
                const date = addDays(this.weekStart, index)
                return { key: date, date, day: dateOf(date).getDate(), today: date === this.today, summary: summary.get(date) || null }
            })
        },
        monthCells() {
            const summary = this.markMap
            const [year, month] = monthOf(this.selectedDate).split('-').map(Number)
            const first = new Date(year, month - 1, 1)
            const lead = first.getDay()
            const days = new Date(year, month, 0).getDate()
            const cells = []
            for (let index = 0; index < 42; index++) {
                const date = new Date(year, month - 1, 1 + index - lead)
                const key = keyOf(date)
                cells.push({ key, date: key, day: date.getDate(), outside: date.getMonth() !== month - 1, today: key === this.today, summary: summary.get(key) || null })
                if (index >= lead + days - 1 && (index + 1) % 7 === 0) break
            }
            return cells
        },
        periodTitle() {
            if (this.mode === 'week') {
                const start = dateOf(this.weekStart)
                const end = dateOf(addDays(this.weekStart, 6))
                const sameYear = end.getFullYear() === start.getFullYear()
                const endPart = (sameYear ? '' : end.getFullYear() + '年') + (end.getMonth() === start.getMonth() ? '' : (end.getMonth() + 1) + '月')
                return start.getFullYear() + '年' + (start.getMonth() + 1) + '月' + start.getDate() + '日—' + endPart + end.getDate() + '日'
            }
            return this.selectedDate.slice(0, 4) + '年' + Number(this.selectedDate.slice(5, 7)) + '月'
        },
        selectedDateText() {
            const date = dateOf(this.selectedDate)
            return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 · 星期' + WEEKDAYS[date.getDay()]
        },
        processOptions() { return this.catalogs.processes || [] },
        shiftOptions() { return this.catalogs.shifts || [] },
        processNames() { return ['全部工序'].concat(this.processOptions.map(row => row.name)) },
        shiftNames() { return ['全部班次'].concat(this.shiftOptions.map(row => row.name)) },
        filtersActive() { return this.processIndex > 0 || this.shiftIndex > 0 },
        filteredRows() {
            const processId = this.processIndex > 0 ? (this.processOptions[this.processIndex - 1] || {})._id : ''
            const shiftId = this.shiftIndex > 0 ? (this.shiftOptions[this.shiftIndex - 1] || {})._id : ''
            // 休息/请假行没有工序和班次，带筛选时不参与统计。
            return this.list.filter(row => {
                if (processId && row.processId !== processId) return false
                if (shiftId && (row.kind === 'rest' || row.shiftId !== shiftId)) return false
                return true
            })
        },
        batchRows() {
            const batches = new Map()
            for (const row of this.filteredRows) {
                for (const batchNo of row.batchNos || []) {
                    if (!batches.has(batchNo)) batches.set(batchNo, { batchNo, processes: new Set(), shifts: new Set() })
                    const item = batches.get(batchNo)
                    if (row.processName) item.processes.add(row.processName)
                    if (row.shiftName) item.shifts.add(row.shiftName)
                }
            }
            return [...batches.values()].sort((left, right) => left.batchNo.localeCompare(right.batchNo)).map(item => ({
                batchNo: item.batchNo,
                detail: [...item.processes, ...item.shifts].filter(Boolean).join(' · ') || '点击查看批次追溯'
            }))
        },
        personRows() {
            const people = new Map()
            for (const row of this.filteredRows) {
                const key = row.personId || row.personName || row._id
                if (!people.has(key)) people.set(key, { key, name: row.personName || '未命名', details: [] })
                const item = people.get(key)
                const detail = row.kind === 'rest' ? (row.absenceType === 'leave' ? '请假' : '休息') : [row.post || '岗位待定', this.timeLabel(row)].filter(Boolean).join(' · ')
                if (!item.details.includes(detail)) item.details.push(detail)
            }
            return [...people.values()].sort((left, right) => left.name.localeCompare(right.name)).map(item => ({ key: item.key, name: item.name, detail: item.details.join('；') }))
        },
        batchCount() { return this.batchRows.length },
        personCount() { return this.personRows.length }
    },
    onShow() { this.load() },
    methods: {
        name: operationName,
        load() {
            return loadOperations(this, () => Promise.all([
                callOperations('bootstrap'),
                this.mode === 'week'
                    ? callOperations('scheduleCalendar', { dateFrom: this.weekStart, dateTo: addDays(this.weekStart, 6) })
                    : callOperations('scheduleCalendar', { month: monthOf(this.selectedDate) })
            ]), ([base, calendar]) => {
                this.catalogs = base.catalogs
                this.marks = calendar.days || []
                this.marksReady = true
                this.processIndex = Math.min(this.processIndex, this.processNames.length - 1)
                this.shiftIndex = Math.min(this.shiftIndex, this.shiftNames.length - 1)
                return this.loadDay()
            })
        },
        /** 当天明细走现有 listSchedules；按 50 条分页拉取，避免大车间当天超过一页被截断。 */
        async loadDay() {
            const epoch = ++this.detailEpoch
            const pageEpoch = this.loadEpoch
            const current = () => this.detailEpoch === epoch && this.loadEpoch === pageEpoch
            this.loadingDetail = true
            try {
                const rows = []
                let total = 0
                for (let page = 1; page <= Math.ceil(MAX_DAY_ROWS / 50); page++) {
                    const result = await callOperations('listSchedules', { dateFrom: this.selectedDate, dateTo: this.selectedDate, page, pageSize: 50 })
                    if (!current()) return
                    total = result.total || 0
                    rows.push(...(result.list || []))
                    if (rows.length >= total || !(result.list || []).length) break
                }
                this.list = rows
                this.detailTotal = total
            } catch (error) {
                if (current()) { this.error = error.message || '加载失败，请重试'; this.list = []; this.detailTotal = 0 }
            } finally {
                if (current()) this.loadingDetail = false
            }
        },
        shiftMarker(summary) {
            const names = (summary.shifts || []).map(item => item.name).slice(0, 2)
            if (!names.length) return ''
            return names.join('/') + ((summary.shifts || []).length > 2 ? '+' : '')
        },
        switchMode(mode) {
            if (this.mode === mode) return
            this.mode = mode; this.marks = []; this.marksReady = false; this.list = []; this.detailTotal = 0
            this.load()
        },
        shiftPeriod(delta) {
            this.selectedDate = this.mode === 'week' ? addDays(this.selectedDate, delta * 7) : shiftMonthKey(this.selectedDate, delta)
            this.marks = []; this.marksReady = false; this.list = []; this.detailTotal = 0; this.processIndex = 0; this.shiftIndex = 0
            this.load()
        },
        goCurrent() {
            this.selectedDate = this.today
            this.marks = []; this.marksReady = false; this.list = []; this.detailTotal = 0
            this.load()
        },
        selectDay(cell) {
            if (cell.date === this.selectedDate) return
            this.selectedDate = cell.date; this.list = []; this.detailTotal = 0
            if (cell.outside) { this.marksReady = false; this.marks = []; this.load(); return }
            this.loadDay()
        },
        changeProcess(event) { this.processIndex = Number(event.detail.value) || 0 },
        changeShift(event) { this.shiftIndex = Number(event.detail.value) || 0 },
        timeLabel(row) {
            if (row.kind === 'rest') return ''
            const start = Number(row.startDayOffset) || 0
            const end = row.endDayOffset == null ? start + (row.endTime <= row.startTime ? 1 : 0) : Number(row.endDayOffset)
            return (start ? '次日 ' : '当天 ') + row.startTime + '–' + (end ? '次日 ' : '当天 ') + row.endTime
        },
        openTrace(batchNo) { uni.navigateTo({ url: '/pages/operations/trace?batchNo=' + encodeURIComponent(batchNo) }) },
        goAttendance() { uni.navigateTo({ url: '/pages/operations/attendance' }) },
        clearLoaded() { this.list = []; this.detailTotal = 0 }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.cal-card { padding: 24rpx 20rpx; }
.cal-top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; flex-wrap: wrap; }
.cal-segmented { display: flex; padding: 4rpx; border-radius: 16rpx; background: $canvas; }
.cal-seg { margin: 0; padding: 0 24rpx; min-height: 56rpx; line-height: 56rpx; font-size: 26rpx; border-radius: 12rpx; background: transparent; color: $muted; }
.cal-seg::after { border: 0; }
.cal-seg.active { background: $surface; color: $primary; font-weight: 600; }
.cal-actions { display: flex; align-items: center; gap: 8rpx; }
.cal-none { margin: 0; padding: 0 18rpx; min-height: 56rpx; line-height: 56rpx; font-size: 24rpx; border-radius: 12rpx; background: $canvas; color: $primary; }
.cal-none::after { border: 0; }
.cal-nav { margin: 0; padding: 0; width: 56rpx; height: 56rpx; line-height: 56rpx; text-align: center; border-radius: 12rpx; background: $canvas; color: $primary; font-size: 32rpx; }
.cal-nav::after { border: 0; }
.cal-title { display: block; font-size: 30rpx; font-weight: 700; margin: 16rpx 0 12rpx; }
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6rpx; margin-bottom: 8rpx; }
.cal-weekday { text-align: center; color: $muted; font-size: 22rpx; }
.week-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6rpx; }
.week-cell { position: relative; box-sizing: border-box; min-height: 108rpx; padding: 10rpx 4rpx; border-radius: 12rpx; border: 1rpx solid $line; background: $surface; display: flex; flex-direction: column; align-items: center; }
.week-cell.today { border-color: $primary; }
.week-cell.selected { background: $primary-soft; border-color: $primary; }
.week-day { font-size: 26rpx; font-weight: 600; line-height: 1.3; }
.week-shift { margin-top: 4rpx; font-size: 18rpx; color: $primary; line-height: 1.3; text-align: center; word-break: break-all; }
.week-rest { margin-top: 4rpx; font-size: 18rpx; color: $warning; line-height: 1.3; }
.week-leave { margin-top: 4rpx; font-size: 18rpx; color: $muted; line-height: 1.3; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6rpx; }
.cal-cell { position: relative; box-sizing: border-box; min-height: 92rpx; padding: 8rpx 4rpx; border-radius: 12rpx; background: $surface; border: 1rpx solid $line; display: flex; flex-direction: column; align-items: center; }
.cal-cell.outside { opacity: .35; }
.cal-cell.today { border-color: $primary; }
.cal-cell.selected { background: $primary-soft; border-color: $primary; }
.cal-cell.mine { border-width: 2rpx; }
.cal-day { font-size: 26rpx; font-weight: 600; line-height: 1.3; }
.cal-count { font-size: 20rpx; color: $primary; line-height: 1.4; margin-top: 2rpx; }
.cal-rest { font-size: 18rpx; color: $warning; line-height: 1.4; margin-top: 2rpx; }
.cal-leave { font-size: 18rpx; color: $muted; line-height: 1.4; margin-top: 2rpx; }
.cal-mine-dot { position: absolute; left: 50%; bottom: 6rpx; margin-left: -4rpx; width: 8rpx; height: 8rpx; border-radius: 50%; background: $primary; }
.cal-empty { display: block; padding: 16rpx 0 0; text-align: center; }
.cal-skeleton { padding: 8rpx 0; }
.cal-skeleton-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6rpx; margin-bottom: 6rpx; }
.cal-skeleton-cell { height: 92rpx; border-radius: 12rpx; background: $canvas; }
.cal-skeleton-note { display: block; text-align: center; padding-top: 12rpx; }
.plan-card { margin-top: 24rpx; }
.filter-row { display: flex; flex-wrap: wrap; gap: 16rpx; margin: 16rpx 0; }
.filter-button { margin: 0; padding: 0 20rpx; min-height: 64rpx; line-height: 64rpx; font-size: 24rpx; }
.chips { display: flex; flex-wrap: wrap; gap: 16rpx; margin-bottom: 16rpx; }
.chip { display: inline-block; font-size: 22rpx; color: $primary; background: $primary-soft; padding: 8rpx 18rpx; border-radius: 12rpx; }
.plan-columns { display: flex; flex-wrap: wrap; gap: 20rpx; }
.plan-col { flex: 1 1 300rpx; min-width: 0; }
.plan-title { display: flex; align-items: center; justify-content: space-between; font-size: 28rpx; font-weight: 700; padding: 12rpx 0; border-bottom: 1rpx solid $line; }
.plan-row { display: flex; flex-direction: column; gap: 4rpx; padding: 16rpx 0; border-bottom: 1rpx solid $line; }
.plan-row:last-child { border-bottom: 0; }
.plan-code { font-family: monospace; font-size: 26rpx; color: $primary; }
.plan-person { font-size: 28rpx; font-weight: 600; }
</style>
