<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">日期为生产日；日历只显示本人班次，选中有排班的日期查看当天安排。</text></view>

        <view class="fw-card cal-card">
            <view class="cal-top">
                <view class="cal-segmented">
                    <button class="cal-seg" :class="{ active: mode === 'week' }" @tap="switchMode('week')">周视图</button>
                    <button class="cal-seg" :class="{ active: mode === 'month' }" @tap="switchMode('month')">月视图</button>
                </view>
                <view class="cal-actions">
                    <button class="cal-none" :disabled="loading" @tap="goCurrent">{{ mode === 'week' ? '本周' : '本月' }}</button>
                    <button class="cal-nav" :disabled="loading" @tap.stop="prevPeriod" aria-label="上一周期"><uni-icons type="back" size="16" color="#008577"></uni-icons></button>
                    <button class="cal-nav" :disabled="loading" @tap.stop="nextPeriod" aria-label="下一周期"><uni-icons type="forward" size="16" color="#008577"></uni-icons></button>
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
                      :class="{ today: cell.today, selected: cell.date === selectedDate, off: cell.dayInfo && cell.dayInfo.mine && cell.dayInfo.mine.kind !== 'work' }"
                      @tap="selectDay(cell)">
                    <text class="week-day">{{ cell.day }}</text>
                    <text v-if="shiftLabel(cell.dayInfo)" class="cell-shift">{{ shiftLabel(cell.dayInfo) }}</text>
                    <view v-else-if="absenceOf(cell.dayInfo)" class="cell-dot" :class="absenceOf(cell.dayInfo)" />
                </view>
            </view>

            <view v-else class="cal-grid">
                <view v-for="cell in monthCells" :key="cell.key" class="cal-cell"
                      :class="{ outside: cell.outside, today: cell.today, selected: cell.date === selectedDate, off: cell.dayInfo && cell.dayInfo.mine && cell.dayInfo.mine.kind !== 'work' }"
                      @tap="selectDay(cell)">
                    <text class="cal-day">{{ cell.day }}</text>
                    <text v-if="shiftLabel(cell.dayInfo)" class="cell-shift">{{ shiftLabel(cell.dayInfo) }}</text>
                    <view v-else-if="absenceOf(cell.dayInfo)" class="cell-dot" :class="absenceOf(cell.dayInfo)" />
                </view>
            </view>
            <text v-if="!loading && marksReady && !days.length" class="fw-note cal-empty">{{ mode === 'week' ? '本周暂无排班。' : '本月暂无排班。' }}</text>
            <view class="cal-legend">
                <text class="legend-item"><text class="legend-dot rest" />休息</text>
                <text class="legend-item"><text class="legend-dot leave" />请假</text>
                <text class="legend-item">班次字＝本人班次</text>
            </view>
        </view>

        <view class="fw-card plan-card">
            <view class="fw-heading"><text class="fw-heading-title">当日安排</text><text class="fw-badge">本人范围</text></view>
            <text class="op-meta">{{ selectedDateText }} · 只显示本人或有权限范围内的排班。</text>
            <view class="filter-row">
                <picker :range="processNames" :value="processIndex" :disabled="loadingDay" @change="changeProcess">
                    <view class="fw-button secondary filter-button">{{ processNames[processIndex] }}<view class="filter-caret"><uni-icons type="bottom" size="10" color="#77827D"></uni-icons></view></view>
                </picker>
                <picker :range="shiftNames" :value="shiftIndex" :disabled="loadingDay" @change="changeShift">
                    <view class="fw-button secondary filter-button">{{ shiftNames[shiftIndex] }}<view class="filter-caret"><uni-icons type="bottom" size="10" color="#77827D"></uni-icons></view></view>
                </picker>
            </view>
            <view class="chips">
                <text class="chip">{{ batchCount }} 个批号</text>
                <text class="chip">{{ personCount }} 人</text>
            </view>

            <view v-if="loadingDay && !groups.length" class="fw-note">正在加载当天安排…</view>
            <view class="plan-columns">
                <view class="plan-col plan-col-batch">
                    <view class="plan-title"><text>具体批号</text><text class="plan-count">{{ batchCount }} 个</text></view>
                    <view v-for="row in batchRows" :key="row.batchNo" class="plan-row" @tap="openTrace(row.batchNo)">
                        <text class="plan-code">{{ row.batchNo }}</text>
                        <text class="op-meta plan-meta">{{ row.detail }}</text>
                    </view>
                    <text v-if="!batchRows.length && !loadingDay" class="op-meta plan-meta">本组暂无批号</text>
                </view>
                <view class="plan-col plan-col-person">
                    <view class="plan-title"><text>人员与岗位</text><text class="plan-count">{{ personCount }} 人</text></view>
                    <view v-for="row in personRows" :key="row.personId" class="plan-row" :class="{ me: row.isMe }">
                        <text class="plan-person">{{ row.name }}<text v-if="row.isMe" class="me-tag">我</text></text>
                        <text class="op-meta plan-meta" :class="{ pending: !row.post }">{{ row.post || '待分配' }}</text>
                    </view>
                    <text v-if="!personRows.length && !loadingDay" class="op-meta plan-meta">当天这一组暂无排班人员。</text>
                </view>
            </view>
            <text v-if="filtersActive" class="fw-note">已按{{ processNames[processIndex] }}{{ shiftNames[shiftIndex] }}筛选；统计与两栏都随筛选变化。</text>
            <text v-if="!groups.length && !loadingDay" class="fw-note">当天没有排班或休息。</text>
        </view>

        <button class="fw-button secondary attendance-entry" @tap="goAttendance">查看我的考勤记录</button>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationDate, loadBootstrap } from '@/utils/operations-api.js'
import { openPage } from '@/utils/vk-migration.js'
import { displayBatchNo } from '@/utils/batch-display.js'

// 月历 7 列宽度见 style：calc((100% - 42rpx) / 7)，容器负边距补偿第 7 个 margin
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(value) { return String(value).padStart(2, '0') }
/** 班次短名：去掉「（8小时）」这类说明后缀，避免左列批号副标题被截断。 */
function shortShiftName(name) { return String(name || '').replace(/[（(].*$/, '') }
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
            days: [],
            marksReady: false,
            day: { date: '', mine: null, groups: [] },
            loadingDay: false,
            detailEpoch: 0,
            catalogs: {},
            processIndex: 0,
            shiftIndex: 0
        }
    },
    computed: {
        markMap() { return new Map(this.days.map(day => [day.date, day])) },
        weekStart() { const date = dateOf(this.selectedDate); return addDays(this.selectedDate, -date.getDay()) },
        weekDays() {
            const marks = this.markMap
            return Array.from({ length: 7 }, (_, index) => {
                const date = addDays(this.weekStart, index)
                return { key: date, date, day: dateOf(date).getDate(), today: date === this.today, dayInfo: marks.get(date) || null }
            })
        },
        monthCells() {
            const marks = this.markMap
            const [year, month] = monthOf(this.selectedDate).split('-').map(Number)
            const first = new Date(year, month - 1, 1)
            const lead = first.getDay()
            const days = new Date(year, month, 0).getDate()
            const cells = []
            for (let index = 0; index < 42; index++) {
                const date = new Date(year, month - 1, 1 + index - lead)
                const key = keyOf(date)
                cells.push({ key, date: key, day: date.getDate(), outside: date.getMonth() !== month - 1, today: key === this.today, dayInfo: marks.get(key) || null })
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
        groups() { return this.day.groups || [] },
        processOptions() { return this.catalogs.processes || [] },
        shiftOptions() { return this.catalogs.shifts || [] },
        processNames() { return ['全部工序'].concat(this.processOptions.map(row => row.name)) },
        shiftNames() { return ['全部班次'].concat(this.shiftOptions.map(row => row.name)) },
        filtersActive() { return this.processIndex > 0 || this.shiftIndex > 0 },
        /** 右栏按「同工序+同班次」这一组显示：有筛选取对应组，全部时合并当天所有组。 */
        filteredGroups() {
            const process = this.processIndex > 0 ? (this.processOptions[this.processIndex - 1] || {}) : null
            const shift = this.shiftIndex > 0 ? (this.shiftOptions[this.shiftIndex - 1] || {}) : null
            return this.groups.filter(group => (!process || group.processId === process._id) && (!shift || group.shiftId === shift._id))
        },
        /** 只保留 11 位合规批号；不合规的不占位，计数同步按过滤后算。 */
        batchRows() {
            const batches = new Map()
            for (const group of this.filteredGroups) {
                for (const raw of group.batchNos || []) {
                    const batchNo = displayBatchNo(raw)
                    if (!batchNo) continue
                    if (!batches.has(batchNo)) batches.set(batchNo, { batchNo, details: new Set() })
                    batches.get(batchNo).details.add([group.processName, shortShiftName(group.shiftName)].filter(Boolean).join(' · '))
                }
            }
            return [...batches.values()].sort((left, right) => left.batchNo.localeCompare(right.batchNo)).map(item => ({ batchNo: item.batchNo, detail: [...item.details].filter(Boolean).join('；') || '点击查看批次追溯' }))
        },
        personRows() {
            const people = new Map()
            for (const group of this.filteredGroups) {
                for (const member of group.members || []) {
                    if (!people.has(member.personId)) people.set(member.personId, { personId: member.personId, name: member.name, posts: new Set(), isMe: false })
                    const item = people.get(member.personId)
                    if (member.post) item.posts.add(member.post)
                    if (member.isMe) item.isMe = true
                }
            }
            return [...people.values()]
                .sort((left, right) => Number(right.isMe) - Number(left.isMe) || left.name.localeCompare(right.name))
                .map(item => ({ personId: item.personId, name: item.name, isMe: item.isMe, post: [...item.posts].join(' / ') }))
        },
        batchCount() { return this.batchRows.length },
        personCount() { return this.personRows.length }
    },
    onShow() { this.load() },
    methods: {
        /** 日历 + 当天组信息一次拉取；切日期只调 myScheduleDay。 */
        load() {
            const range = this.mode === 'week'
                ? { dateFrom: this.weekStart, dateTo: addDays(this.weekStart, 6) }
                : { month: monthOf(this.selectedDate) }
            return loadOperations(this, async () => {
                const base = await loadBootstrap()
                const calendar = await callOperations('scheduleCalendar', { ...range, date: this.selectedDate })
                return [base, calendar]
            }, ([base, calendar]) => {
                this.catalogs = (base && base.catalogs) || {}
                this.processIndex = Math.min(this.processIndex, this.processNames.length - 1)
                this.shiftIndex = Math.min(this.shiftIndex, this.shiftNames.length - 1)
                this.days = calendar.days || []
                this.marksReady = true
                const selected = this.days.find(day => day.date === this.selectedDate) || { mine: null, groups: [] }
                this.applyDay({ date: this.selectedDate, mine: selected.mine || null, groups: selected.groups || [] })
            })
        },
        applyDay(day) { this.day = { date: day.date, mine: day.mine || null, groups: day.groups || [] } },
        async loadDay() {
            if (this.loadingDay) return
            const epoch = ++this.detailEpoch
            this.loadingDay = true
            try {
                const day = await callOperations('myScheduleDay', { date: this.selectedDate })
                if (this.detailEpoch !== epoch) return
                this.applyDay({ date: day.date || this.selectedDate, mine: day.mine || null, groups: day.groups || [] })
            } catch (error) {
                if (this.detailEpoch === epoch) { this.error = error.message || '加载当天安排失败'; this.applyDay({ date: this.selectedDate, mine: null, groups: [] }) }
            } finally {
                if (this.detailEpoch === epoch) this.loadingDay = false
            }
        },
        shiftLabel(dayInfo) {
            if (!dayInfo || !dayInfo.mine || dayInfo.mine.kind !== 'work') return ''
            const name = shortShiftName(dayInfo.mine.shiftName)
            if (/夜/.test(name)) return '夜'
            if (/早/.test(name)) return '早'
            if (/中/.test(name)) return '中'
            if (/晚/.test(name)) return '晚'
            return name.slice(0, 2)
        },
        absenceOf(dayInfo) {
            if (!dayInfo || !dayInfo.mine) return ''
            if (dayInfo.mine.kind === 'leave') return 'leave'
            if (dayInfo.mine.kind === 'rest') return 'rest'
            return ''
        },
        switchMode(mode) {
            if (this.mode === mode) return
            this.mode = mode; this.days = []; this.marksReady = false
            this.applyDay({ date: this.selectedDate, mine: null, groups: [] })
            this.load()
        },
        prevPeriod() { this.shiftPeriod(-1) },
        nextPeriod() { this.shiftPeriod(1) },
        shiftPeriod(delta) {
            const step = Number(delta)
            if (!Number.isFinite(step) || !step) return
            this.selectedDate = this.mode === 'week' ? addDays(this.selectedDate, step * 7) : shiftMonthKey(this.selectedDate, step)
            this.days = []; this.marksReady = false
            this.processIndex = 0; this.shiftIndex = 0
            this.applyDay({ date: this.selectedDate, mine: null, groups: [] })
            this.load()
        },
        goCurrent() {
            this.selectedDate = this.today
            this.days = []; this.marksReady = false
            this.processIndex = 0; this.shiftIndex = 0
            this.applyDay({ date: this.selectedDate, mine: null, groups: [] })
            this.load()
        },
        selectDay(cell) {
            if (cell.date === this.selectedDate) return
            this.selectedDate = cell.date
            if (cell.outside) { this.days = []; this.marksReady = false; this.load(); return }
            this.loadDay()
        },
        changeProcess(event) { this.processIndex = Number(event.detail.value) || 0 },
        changeShift(event) { this.shiftIndex = Number(event.detail.value) || 0 },
        openTrace(batchNo) { openPage('operations.trace', { batchNo }) },
        goAttendance() { uni.switchTab({ url: '/pages/operations/attendance' }) },
        clearLoaded() { this.days = []; this.marksReady = false; this.applyDay({ date: this.selectedDate, mine: null, groups: [] }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.cal-card { padding: 16rpx 20rpx; }
.cal-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.cal-segmented { display: flex; padding: 4rpx; border-radius: 16rpx; background: $canvas; }
.cal-seg { margin: 0; padding: 0 16rpx; min-height: 56rpx; line-height: 56rpx; font-size: 26rpx; border-radius: 12rpx; background: transparent; color: $muted; }
.cal-seg::after { border: 0; }
.cal-seg.active { background: $surface; color: $primary; font-weight: 600; }
.cal-actions { display: flex; align-items: center; margin-left: 12rpx; }
.cal-actions .cal-none, .cal-actions .cal-nav { margin-right: 6rpx; }
.cal-none { margin: 0; padding: 0 12rpx; min-height: 56rpx; line-height: 56rpx; font-size: 24rpx; border-radius: 12rpx; background: $canvas; color: $primary; }
.cal-none::after { border: 0; }
.cal-nav { margin: 0; padding: 0; width: 56rpx; height: 56rpx; display: flex; align-items: center; justify-content: center; border-radius: 12rpx; background: $canvas; }
.cal-nav::after { border: 0; }
.cal-title { display: block; font-size: 30rpx; font-weight: 700; margin: 12rpx 0 12rpx; }
.cal-week { display: flex; margin-right: -6rpx; margin-bottom: 6rpx; }
.cal-weekday { flex: 1 1 0; min-width: 0; margin-right: 6rpx; text-align: center; color: $muted; font-size: 22rpx; }
.week-row { display: flex; margin-right: -6rpx; }
.week-cell { flex: 1 1 0; min-width: 0; margin-right: 6rpx; position: relative; box-sizing: border-box; min-height: 108rpx; padding: 10rpx 4rpx; border-radius: 12rpx; border: 1rpx solid $line; background: $surface; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
.week-cell.off { background: $canvas; }
.week-cell.today { border-color: $primary; }
.week-cell.selected { background: $primary-soft; border-color: $primary; }
.week-day { font-size: 26rpx; font-weight: 600; line-height: 1.3; }
.cell-shift { margin-top: 6rpx; font-size: 24rpx; font-weight: 600; color: $primary; line-height: 1.3; }
.cell-dot { width: 14rpx; height: 14rpx; margin-top: 8rpx; border-radius: 50%; background: $muted; }
.cell-dot.leave { background: $warning; }
.cal-grid { display: flex; flex-wrap: wrap; margin-right: -6rpx; }
/* 7 列固定：7×(基宽-容器负边距补偿) + 7×margin 恰好等于容器宽，flex-wrap 保证每行 7 个 */
.cal-cell { flex: 0 0 calc((100% - 42rpx) / 7); min-width: 0; margin-right: 6rpx; margin-bottom: 6rpx; position: relative; box-sizing: border-box; min-height: 92rpx; padding: 6rpx 4rpx; border-radius: 12rpx; background: $surface; border: 1rpx solid $line; display: flex; flex-direction: column; align-items: center; }
.cal-cell.outside { opacity: .35; }
.cal-cell.off { background: $canvas; }
.cal-cell.today { border-color: $primary; }
.cal-cell.selected { background: $primary-soft; border-color: $primary; }
.cal-day { font-size: 26rpx; font-weight: 600; line-height: 1.3; }
.cal-empty { display: block; padding: 12rpx 0 0; text-align: center; }
.cal-skeleton { padding: 6rpx 0; }
.cal-skeleton-row { display: flex; margin-right: -6rpx; margin-bottom: 6rpx; }
.cal-skeleton-cell { flex: 1 1 0; min-width: 0; margin-right: 6rpx; height: 92rpx; border-radius: 12rpx; background: $canvas; }
.cal-skeleton-note { display: block; text-align: center; padding-top: 12rpx; }
.cal-legend { display: flex; flex-wrap: wrap; align-items: center; padding-top: 8rpx; color: $muted; font-size: 20rpx; }
.cal-legend .legend-item { margin-right: 12rpx; }
.legend-item { display: flex; align-items: center; }
.legend-dot { display: inline-block; width: 12rpx; height: 12rpx; border-radius: 50%; background: $muted; margin-right: 4rpx; }
.legend-dot.leave { background: $warning; }
.plan-card { margin-top: 16rpx; }
.filter-row { display: flex; flex-wrap: wrap; margin: 12rpx 0; }
.filter-row .filter-button { margin-right: 12rpx; }
.filter-button { margin: 0; padding: 0 20rpx; min-height: 64rpx; line-height: 64rpx; font-size: 24rpx; display: flex; align-items: center; }
.filter-caret { display: flex; align-items: center; margin-left: 4rpx; }
.chips { display: flex; flex-wrap: wrap; margin-bottom: 12rpx; }
.chips .chip { margin-right: 12rpx; }
.chip { display: inline-block; font-size: 22rpx; color: $primary; background: $primary-soft; padding: 6rpx 12rpx; border-radius: 12rpx; }
.plan-columns { display: flex; align-items: flex-start; }
.plan-col-batch { flex: 0 0 40%; max-width: 40%; margin-right: 16rpx; }
.plan-col-person { flex: 1 1 0; min-width: 0; }
.plan-col { min-width: 0; }
.plan-col-person { padding-left: 16rpx; border-left: 1rpx solid $line; }
.plan-title { display: flex; align-items: center; justify-content: space-between; font-size: 26rpx; font-weight: 700; padding: 12rpx 0; border-bottom: 1rpx solid $line; white-space: nowrap; }
.plan-title .plan-count { margin-left: 8rpx; }
.plan-count { font-size: 20rpx; font-weight: 400; color: $muted; }
.plan-row { display: flex; flex-direction: column; padding: 12rpx 0; border-bottom: 1rpx solid $line; min-width: 0; }
.plan-row .plan-meta { margin-top: 4rpx; }
.plan-row:last-child { border-bottom: 0; }
.plan-row.me { background: $primary-soft; border-radius: 8rpx; padding-left: 8rpx; padding-right: 8rpx; }
.plan-code { font-family: monospace; font-size: 24rpx; line-height: 1.35; color: $primary; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-person { font-size: 26rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-row .plan-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-row.me .plan-person { font-weight: 700; color: $primary; }
.me-tag { margin-left: 6rpx; padding: 0 8rpx; border-radius: 4rpx; background: $primary; color: $surface; font-size: 18rpx; font-weight: normal; }
.op-meta.pending { color: $warning; }
.attendance-entry { margin-top: 16rpx; width: 100%; }
</style>
