<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">P0 地基验证页：vk client 已接入，这里用 vk.callFunction 走 router 取数，并用现有 production-operations 拉同一份做对照。只读。</text></view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">运行环境</text><text class="fw-badge" :class="{ warn: !vkReady }">{{ vkReady ? 'vk 已挂载' : 'vk 未挂载' }}</text></view>
            <view class="pilot-row"><text class="pilot-label">登录 token</text><text class="op-meta">{{ tokenText }}</text></view>
            <view class="pilot-row"><text class="pilot-label">router 云函数</text><text class="op-meta">{{ routerState }}</text></view>
            <view class="pilot-row"><text class="pilot-label">统计周期</text><text class="op-meta">{{ period }}</text></view>
        </view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">vk.callFunction · mes/myAttendance</text><text class="fw-badge" :class="{ warn: vkState !== '成功' }">{{ vkState }}</text></view>
            <text class="fw-note">router 尚未上传时这里会显示错误原因；上传后与下方对照条数应一致。</text>
            <text v-if="vkError" class="pilot-error">{{ vkError }}</text>
            <text v-else class="fw-note">{{ vkSummary }}</text>
        </view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">对照 · production-operations</text><text class="fw-badge" :class="{ warn: legacyState !== '成功' }">{{ legacyState }}</text></view>
            <text v-if="legacyError" class="pilot-error">{{ legacyError }}</text>
            <text v-else class="fw-note">{{ legacySummary }}</text>
        </view>

        <view class="pilot-actions">
            <button class="fw-button secondary" :disabled="loading" @tap="shiftPeriod(-1)">上一月</button>
            <button class="fw-button" :disabled="loading" @tap="load">{{ loading ? '读取中…' : '重新拉取' }}</button>
            <button class="fw-button secondary" :disabled="loading" @tap="shiftPeriod(1)">下一月</button>
        </view>
    </view>
</template>
<script>
import { getToken } from '@/utils/auth.js'
import { callOperations } from '@/utils/operations-api.js'

function monthOf(key) { return key.slice(0, 7) }
function shiftMonth(period, delta) {
    const [year, month] = period.split('-').map(Number)
    const date = new Date(year, month - 1 + Number(delta), 1)
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(1, last))
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
}

export default {
    data() {
        return {
            // 默认取有历史数据的 2026-06，便于与现有接口逐一对照
            period: '2026-06',
            loading: false,
            vkState: '未调用',
            vkError: '',
            vkSummary: '',
            legacyState: '未调用',
            legacyError: '',
            legacySummary: ''
        }
    },
    computed: {
        vkReady() { return !!(this.vk && typeof this.vk.callFunction === 'function') },
        token() { return getToken() },
        tokenText() {
            const value = this.token
            return value ? '已登录（token ' + String(value).length + ' 位）' : '无 token，请先登录'
        },
        routerState() { return this.vkState === '成功' ? '已连通' : '未知（取决于下方调用结果）' }
    },
    onShow() { this.load() },
    methods: {
        query() {
            return { periodType: 'month', period: monthOf(this.period), page: 1, pageSize: 20 }
        },
        async load() {
            if (this.loading) return
            this.loading = true
            const query = this.query()
            this.vkState = '调用中'; this.vkError = ''; this.vkSummary = ''
            this.legacyState = '调用中'; this.legacyError = ''; this.legacySummary = ''
            // vk 走 router（url 形式的云函数路由）
            try {
                const result = await this.vk.callFunction({ url: 'mes/myAttendance', data: query })
                const rows = (result && result.data && result.data.list) || (result && result.list) || []
                const total = (result && result.data && result.data.total) || (result && result.total) || 0
                this.vkState = '成功'
                this.vkSummary = 'router 返回 ' + rows.length + ' 行（共 ' + total + ' 条）'
            } catch (error) {
                this.vkState = '失败'
                this.vkError = this.readError(error, 'router 调用失败')
            }
            // 现有接口对照（与「我的考勤」页同一 action）
            try {
                const result = await callOperations('myAttendance', Object.assign({}, query))
                this.legacyState = '成功'
                this.legacySummary = '现有接口返回 ' + ((result && result.list) || []).length + ' 行（共 ' + ((result && result.total) || 0) + ' 条）'
            } catch (error) {
                this.legacyState = '失败'
                this.legacyError = this.readError(error, '现有接口调用失败')
            }
            this.loading = false
        },
        shiftPeriod(delta) {
            if (this.loading) return
            this.period = shiftMonth(monthOf(this.period), delta)
            this.load()
        },
        readError(error, fallback) {
            if (!error) return fallback
            if (typeof error === 'string') return error
            const message = error.message || error.errMsg || error.msg
            if (message) return message
            try { return JSON.stringify(error).slice(0, 300) } catch (e) { return fallback }
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/operations.scss';

.pilot-row { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 0; border-bottom: 1rpx solid $line; }
.pilot-row .op-meta { margin-left: 16rpx; }
.pilot-row:last-child { border-bottom: 0; }
.pilot-label { font-size: 28rpx; color: $ink; }
.pilot-error { display: block; margin: 12rpx 0; padding: 16rpx; border-radius: 8rpx; background: rgba(201, 92, 74, 0.08); color: #c95c4a; font-size: 24rpx; line-height: 1.5; word-break: break-all; }
.pilot-actions { display: flex; margin-top: 16rpx; }
.pilot-actions .fw-button + .fw-button { margin-left: 16rpx; }
.pilot-actions .fw-button { flex: 1; margin: 0; }
</style>
