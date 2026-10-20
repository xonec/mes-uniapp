<template>
    <view class="fw-page op-page">
        <view class="rep-head">
            <text class="rep-title" @tap="goCurrentMonth">{{ rangeTitle }}</text>
            <text class="fw-note">点标题回到本月 · 单次最多 31 天</text>
        </view>
        <view class="rep-bar">
            <view class="rep-nav" @tap="shiftRange(-1)"><uni-icons type="back" size="16" color="#008577"></uni-icons></view>
            <picker mode="date" :value="dateFrom" :disabled="loading" @change="setFrom"><view class="rep-date">{{ shortDate(dateFrom) }}</view></picker>
            <text class="rep-sep">~</text>
            <picker mode="date" :value="dateTo" :disabled="loading" @change="setTo"><view class="rep-date">{{ shortDate(dateTo) }}</view></picker>
            <view class="rep-nav" @tap="shiftRange(1)"><uni-icons type="forward" size="16" color="#008577"></uni-icons></view>
            <view class="rep-query" :class="{ disabled: loading }" @tap="load">{{ loading ? '查询中…' : '查询' }}</view>
        </view>
        <view v-if="error" class="fw-notice error">{{ error }}</view>
        <StateView v-if="loading && !result" state="loading" />
        <template v-else-if="result">
            <StateView v-if="!result.rows.length" state="empty" title="所选日期没有报工记录" reason="调整日期区间后重新查询" />
            <template v-else>
                <view v-for="group in metricGroups" :key="group.unit" class="fw-card rep-summary">
                    <view class="fw-heading"><text class="fw-heading-title">{{ group.name }}汇总</text><text class="fw-note">{{ loadedFrom }} 至 {{ loadedTo }}</text></view>
                    <MetricStrip :items="group.items" :columns="group.columns" />
                </view>
                <view class="fw-card">
                    <view class="fw-heading"><text class="fw-heading-title">逐班生产明细</text><text class="fw-note">默认展开最近 3 天，点日期展开/收起</text></view>
                    <view v-for="day in dateGroups" :key="day.date" class="rep-group">
                        <view class="rep-group-head" hover-class="rep-group-hover" @tap="toggle(day.date)">
                            <view class="rep-group-arrow"><uni-icons :type="day.expanded ? 'bottom' : 'right'" size="10" color="#5F6A65"></uni-icons></view>
                            <text class="rep-group-date">{{ day.label }}</text>
                            <text class="rep-group-count">{{ day.rows.length }} 条</text>
                            <text class="rep-group-summary">{{ day.summary }}</text>
                        </view>
                        <view v-if="day.expanded" class="rep-rows">
                            <ListRow class="rep-row" v-for="row in day.rows" :key="row.key" :title="row.batchNo + ' · ' + row.productName" :meta="rowMeta(row)" :badge="unitLabel(row.unit)" badge-tone="neutral" @select="open(row.jobId)" />
                        </view>
                    </view>
                </view>
            </template>
        </template>
    </view>
</template>
<script>
import { callOperations, operationsPage, loadOperations, operationDate, OPERATION_UNITS } from '@/utils/operations-api.js'
import MetricStrip from '@/components/ui/MetricStrip.vue'
import ListRow from '@/components/ui/ListRow.vue'
import StateView from '@/components/ui/StateView.vue'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const EXPANDED_DAYS = 3
function parseDate(value) { const [year, month, day] = String(value || '').split('-').map(Number); return new Date(year, (month || 1) - 1, day || 1) }
function formatDate(date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') }
/** 按自然月平移并夹取月末（10-31 加一个月落到 11-30），避免 Date 直接进位到下月 1 号。 */
function addMonths(value, step) {
    const date = parseDate(value)
    const target = new Date(date.getFullYear(), date.getMonth() + step, 1)
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    target.setDate(Math.min(date.getDate(), lastDay))
    return formatDate(target)
}

export default {
    components: { MetricStrip, ListRow, StateView },
    mixins: [operationsPage],
    data() {
        return { dateFrom: operationDate(), dateTo: operationDate(), loadedFrom: '', loadedTo: '', result: null, expanded: {}, units: OPERATION_UNITS }
    },
    computed: {
        /** 汇总按单位分组；工时是全局值，只在第一组里显示一次。 */
        metricGroups() {
            const totals = (this.result && this.result.totals) || []
            return totals.map((total, index) => {
                const name = this.units[total.unit] || total.unit || '数量'
                const items = [
                    { value: total.goodQty, label: '合格', tone: 'neutral' },
                    { value: total.defectQty, label: '不良', tone: total.defectQty ? 'warning' : 'neutral' },
                    { value: total.inboundQty, label: '入库', tone: 'neutral' }
                ]
                if (index === 0) items.push({ value: this.result.workHours, label: '报工工时', tone: 'primary' })
                return { unit: total.unit, name, items, columns: items.length }
            })
        },
        rangeTitle() {
            const from = String(this.dateFrom || ''), to = String(this.dateTo || '')
            if (from.slice(0, 7) === to.slice(0, 7)) return Number(from.slice(0, 4)) + '年' + Number(from.slice(5, 7)) + '月'
            // 跨年带完整年月日，同年只显示 MM-DD，避免 12-20 ~ 01-05 看不出年份。
            if (from.slice(0, 4) !== to.slice(0, 4)) return from + ' ~ ' + to
            return this.shortDate(from) + ' ~ ' + this.shortDate(to)
        },
        /** 明细按日期倒序分组，组头带行数与汇总，展开状态由 expanded 控制。 */
        dateGroups() {
            const groups = new Map()
            for (const row of (this.result && this.result.rows) || []) {
                if (!groups.has(row.date)) groups.set(row.date, [])
                groups.get(row.date).push({ ...row, key: [row.jobId, row.date, row.shiftId, row.unit].join('|') })
            }
            return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({
                date,
                label: date + ' 周' + WEEKDAYS[parseDate(date).getDay()],
                rows,
                summary: this.daySummary(rows),
                expanded: !!this.expanded[date]
            }))
        }
    },
    onShow() { this.load() },
    methods: {
        load() {
            if (this.loading) return Promise.resolve()
            const dateFrom = this.dateFrom, dateTo = this.dateTo
            return loadOperations(this, () => callOperations('report', { dateFrom, dateTo }), result => {
                this.result = result
                this.loadedFrom = dateFrom
                this.loadedTo = dateTo
                this.resetExpanded(result.rows)
            })
        },
        clearLoaded() { this.result = null; this.expanded = {} },
        /** 默认只展开最近 EXPANDED_DAYS 天，其余折叠成组头。 */
        resetExpanded(rows) {
            const dates = [...new Set((rows || []).map(row => row.date))].sort((a, b) => b.localeCompare(a))
            const expanded = {}
            dates.forEach((date, index) => { expanded[date] = index < EXPANDED_DAYS })
            this.expanded = expanded
        },
        toggle(date) { this.$set(this.expanded, date, !this.expanded[date]) },
        daySummary(rows) {
            const buckets = new Map()
            for (const row of rows) {
                const unit = this.unitLabel(row.unit) || ''
                const item = buckets.get(unit) || { good: 0, inbound: 0 }
                item.good += Number(row.goodQty) || 0
                item.inbound += Number(row.inboundQty) || 0
                buckets.set(unit, item)
            }
            return [...buckets.entries()].map(([unit, item]) => '合格 ' + item.good + (unit ? ' ' + unit : '') + ' · 入库 ' + item.inbound + (unit ? ' ' + unit : '')).join('；')
        },
        shortDate(value) { return String(value || '').slice(5) },
        setFrom(event) { this.dateFrom = event.detail.value; this.load() },
        setTo(event) { this.dateTo = event.detail.value; this.load() },
        /** 回到今天所在月：本月 1 日 ~ 今天。 */
        goCurrentMonth() {
            if (this.loading) return
            const today = operationDate()
            this.dateFrom = today.slice(0, 8) + '01'
            this.dateTo = today
            this.load()
        },
        /** 按自然月平移并夹月末，10-31 加一个月落到 11-30，区间不会超过 31 天。 */
        shiftRange(step) {
            if (this.loading) return
            this.dateFrom = addMonths(this.dateFrom, step)
            this.dateTo = addMonths(this.dateTo, step)
            this.load()
        },
        rowMeta(row) { return [row.shiftName, row.processName, '合格 ' + row.goodQty, '不良 ' + row.defectQty, '入库 ' + row.inboundQty, row.workHours + 'h'].filter(Boolean).join(' · ') },
        unitLabel(unit) { return this.units[unit] || unit },
        open(id) { if (id) uni.navigateTo({ url: '/pages/operations/job-detail?id=' + encodeURIComponent(id) }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.rep-head { display: flex; flex-direction: column;  margin-bottom: var(--sp-8, 8rpx); }
.rep-title { color: $primary; font-size: var(--fs-30, 30rpx); font-weight: 700; white-space: nowrap; }
.rep-bar { display: flex; align-items: center;  margin-bottom: var(--sp-12, 12rpx); }
.rep-nav { width: 52rpx; height: 64rpx; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-button, 12rpx); background: $canvas; }
.rep-date { padding: 0 var(--sp-8, 8rpx); height: 64rpx; line-height: 64rpx; border-radius: var(--radius-button, 12rpx); background: $surface; font-size: var(--fs-28, 28rpx); font-weight: 600; }
.rep-sep { color: $muted; font-size: var(--fs-24, 24rpx); }
.rep-query { margin-left: auto; padding: 0 var(--sp-16, 16rpx); height: 64rpx; line-height: 64rpx; border-radius: var(--radius-button, 12rpx); background: $primary; color: $surface; font-size: var(--fs-24, 24rpx); font-weight: 600; }
.rep-query.disabled { opacity: .6; }
.rep-summary .fw-heading { margin-bottom: var(--sp-8, 8rpx); }
.rep-group + .rep-group { margin-top: var(--sp-4, 4rpx); border-top: 1px solid $line; }
.rep-group-head { display: flex; flex-wrap: wrap; align-items: center;  padding: var(--sp-12, 12rpx) 0; }
.rep-group-hover { background: $canvas; }
.rep-group-arrow { flex-shrink: 0; width: 24rpx; display: flex; align-items: center; justify-content: center; }
.rep-group-date { color: $ink; font-size: var(--fs-28, 28rpx); font-weight: 600; }
.rep-group-count { color: $muted; font-size: var(--fs-22, 22rpx); }
.rep-group-summary { flex-basis: 100%; padding-left: 32rpx; color: $muted; font-size: var(--fs-22, 22rpx); line-height: 1.5; }
.rep-rows { display: flex; flex-direction: column;  padding-bottom: var(--sp-8, 8rpx); }

.rep-head .fw-note { margin-top: 2rpx; }
.rep-bar .rep-nav { margin-right: var(--sp-6, 6rpx); }
.rep-bar .rep-sep { margin: 0 var(--sp-6, 6rpx); }
.rep-bar picker + .rep-nav { margin-left: var(--sp-6, 6rpx); }
.rep-bar .rep-query { margin-left: var(--sp-6, 6rpx); }
.rep-group-head .rep-group-date, .rep-group-head .rep-group-count, .rep-group-head .rep-group-summary { margin-left: var(--sp-8, 8rpx); }
.rep-rows { display: flex; flex-direction: column; }
.rep-row + .rep-row { margin-top: var(--sp-8, 8rpx); }

</style>
