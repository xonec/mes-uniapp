<template>
    <view class="fw-page op-page">
        <view class="fw-header"><text class="fw-subtitle">P0 地基验证页：vk client 已接入，这里用 vk.callFunction 走 router（mes/pub/operation）取 myAttendance，并用现有 production-operations 拉同一份做对照。只读。</text></view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">运行环境</text><text class="fw-badge" :class="{ warn: !vkReady }">{{ vkReady ? 'vk 已挂载' : 'vk 未挂载' }}</text></view>
            <view class="pilot-row"><text class="pilot-label">登录 token</text><text class="op-meta">{{ tokenText }}</text></view>
            <view class="pilot-row"><text class="pilot-label">router 地址</text><text class="op-meta">{{ vkUrl }}</text></view>
            <view class="pilot-row"><text class="pilot-label">统计周期</text><text class="op-meta">{{ period }} · 第 {{ page }} 页 / 每页 {{ pageSize }} 条</text></view>
        </view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">vk.callFunction · mes/pub/operation → myAttendance</text><text class="fw-badge" :class="{ warn: vkState !== '成功' }">{{ vkState }}</text></view>
            <text class="fw-note">router 适配层转发到 production-operations；vk 在云函数内再调云函数，返回值应与现有接口一致。</text>
            <text v-if="vkError" class="pilot-error">{{ vkError }}</text>
            <text v-else class="fw-note">{{ vkSummary }}</text>
            <text v-if="vkRaw" class="op-meta">返回顶层：{{ vkRaw }}</text>
        </view>

        <view class="fw-card">
            <view class="fw-heading"><text class="fw-heading-title">对照 · production-operations</text><text class="fw-badge" :class="{ warn: legacyState !== '成功' }">{{ legacyState }}</text></view>
            <text v-if="legacyError" class="pilot-error">{{ legacyError }}</text>
            <text v-else class="fw-note">{{ legacySummary }}</text>
            <text v-if="legacyRaw" class="op-meta">返回顶层：{{ legacyRaw }}</text>
            <text v-if="consistency" class="pilot-consistency">一致性：{{ consistency }}</text>
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

const VK_URL = 'mes/pub/operation'
const PAGE_SIZE = 5

function shiftMonth(period, delta) {
    const [year, month] = period.split('-').map(Number)
    const date = new Date(year, month - 1 + Number(delta), 1)
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
}

export default {
    data() {
        return {
            // 默认取有历史数据的 2026-06，便于与现有接口逐一对照
            period: '2026-06',
            page: 1,
            pageSize: PAGE_SIZE,
            vkUrl: VK_URL,
            loading: false,
            vkState: '未调用',
            vkError: '',
            vkSummary: '',
            vkRaw: '',
            legacyState: '未调用',
            legacyError: '',
            legacySummary: '',
            legacyRaw: '',
            consistency: ''
        }
    },
    computed: {
        vkReady() { return !!(this.vk && typeof this.vk.callFunction === 'function') },
        token() { return getToken() },
        tokenText() {
            const value = this.token
            return value ? '已登录（token ' + String(value).length + ' 位，uni_id_token 与现有登录共用）' : '无 token，请先登录'
        }
    },
    onShow() { this.load() },
    methods: {
        /** 两边必须完全同参，否则对照没有意义。 */
        query() {
            return { periodType: 'month', period: this.period, page: this.page, pageSize: this.pageSize }
        },
        /** router 可能把业务返回包在 data 里，逐层找带 list 数组的那层，避免依赖 router 包装细节。 */
        payloadOf(value, depth) {
            if (!value || typeof value !== 'object' || (depth || 0) > 4) return null
            if (Array.isArray(value.list)) return value
            return this.payloadOf(value.data, (depth || 0) + 1)
        },
        /** 返回顶层结构（只列一层对象键），用于回答「router 返回结构」这个问题。 */
        structureOf(value) {
            if (!value || typeof value !== 'object') return String(value)
            const describe = item => {
                if (Array.isArray(item)) return 'array(' + item.length + ')'
                if (item && typeof item === 'object') return '{' + Object.keys(item).join(',') + '}'
                return typeof item
            }
            return Object.keys(value).map(key => key + ':' + describe(value[key])).join(' · ')
        },
        summaryText(label, payload) {
            if (!payload) return label + '：返回结构里没有 list 数组'
            const list = payload.list || []
            return label + '：' + list.length + ' 行 / 总数 ' + Number(payload.total || 0)
        },
        compare(vkPayload, legacyPayload) {
            if (!vkPayload || !legacyPayload) return '无法比对（有一侧没有 list 数据）'
            const vkRows = vkPayload.list || [], legacyRows = legacyPayload.list || []
            const vkTotal = Number(vkPayload.total || 0), legacyTotal = Number(legacyPayload.total || 0)
            const ids = rows => rows.map(row => row._id || (row.date + ':' + row.startTime)).join(',')
            if (vkTotal === legacyTotal && ids(vkRows) === ids(legacyRows)) {
                return '一致（总数 ' + vkTotal + '、本页 ' + vkRows.length + ' 行 ID 顺序相同）'
            }
            return '不一致：vk 总数 ' + vkTotal + ' / 现有总数 ' + legacyTotal
        },
        async load() {
            if (this.loading) return
            this.loading = true
            const query = this.query()
            this.vkState = '调用中'; this.vkError = ''; this.vkSummary = ''; this.vkRaw = ''
            this.legacyState = '调用中'; this.legacyError = ''; this.legacySummary = ''; this.legacyRaw = ''
            this.consistency = ''
            // vk 侧：router 适配层 mes/pub/operation → production-operations
            let vkPayload = null
            try {
                const result = await this.vk.callFunction({ url: VK_URL, data: Object.assign({ action: 'myAttendance' }, query) })
                vkPayload = this.payloadOf(result)
                this.vkRaw = this.structureOf(result)
                this.vkState = '成功'
                this.vkSummary = this.summaryText('router 返回', vkPayload)
            } catch (error) {
                this.vkState = '失败'
                this.vkError = this.readError(error, 'router 调用失败')
            }
            // 现有接口对照：与「我的考勤」页同一 action、同一参数
            let legacyPayload = null
            try {
                const result = await callOperations('myAttendance', Object.assign({}, query))
                legacyPayload = this.payloadOf(result)
                this.legacyRaw = this.structureOf(result)
                this.legacyState = '成功'
                this.legacySummary = this.summaryText('现有接口返回', legacyPayload)
            } catch (error) {
                this.legacyState = '失败'
                this.legacyError = this.readError(error, '现有接口调用失败')
            }
            if (vkPayload || legacyPayload) this.consistency = this.compare(vkPayload, legacyPayload)
            this.loading = false
        },
        shiftPeriod(delta) {
            if (this.loading) return
            this.period = shiftMonth(this.period, delta)
            this.page = 1
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
.pilot-row .op-meta { margin-left: 16rpx; text-align: right; }
.pilot-row:last-child { border-bottom: 0; }
.pilot-label { font-size: 28rpx; color: $ink; }
.pilot-error { display: block; margin: 12rpx 0; padding: 16rpx; border-radius: 8rpx; background: rgba(201, 92, 74, 0.08); color: #c95c4a; font-size: 24rpx; line-height: 1.5; word-break: break-all; }
.pilot-consistency { display: block; margin-top: 12rpx; padding: 12rpx 16rpx; border-radius: 8rpx; background: rgba(0, 133, 119, 0.08); color: #008577; font-size: 26rpx; line-height: 1.5; }
.pilot-actions { display: flex; margin-top: 16rpx; }
.pilot-actions .fw-button + .fw-button { margin-left: 16rpx; }
.pilot-actions .fw-button { flex: 1; margin: 0; }
</style>
