<template>
    <view>
        <!-- 3 列 × 2 行：5 只读 + 取样数 1 输入；只读 44rpx/700，0 值灰 -->
        <view class="data-grid">
            <view class="data-cell"><text class="cell-label">入库瓶数</text><text class="cell-value" :class="{ zero: isZero(inboundCount) }"><text class="cell-num">{{ parts(inboundCount).main }}</text><text v-if="parts(inboundCount).unit" class="cell-unit">{{ parts(inboundCount).unit }}</text></text></view>
            <view class="data-cell"><text class="cell-label">取样数（瓶）</text><input class="cell-input" type="number" min="0" :disabled="saving" :value="sampleCount" @input="onSample" /></view>
            <view class="data-cell"><text class="cell-label">领用内包数</text><text class="cell-value" :class="{ zero: isZero(innerIssued) }"><text class="cell-num">{{ parts(innerIssued).main }}</text><text v-if="parts(innerIssued).unit" class="cell-unit">{{ parts(innerIssued).unit }}</text></text></view>
            <view class="data-cell"><text class="cell-label">桶数</text><text class="cell-value" :class="{ zero: !bucketCount }"><text class="cell-num">{{ bucketCount }}</text></text></view>
            <view class="data-cell"><text class="cell-label">入库数</text><text class="cell-value" :class="{ zero: isZero(caseCountText) }"><text class="cell-num">{{ parts(caseCountText).main }}</text><text v-if="parts(caseCountText).unit" class="cell-unit">{{ parts(caseCountText).unit }}</text></text></view>
            <view class="data-cell"><text class="cell-label">托码</text><text class="cell-value" :class="{ zero: isZero(palletCode) }"><text class="cell-num">{{ parts(palletCode).main }}</text><text v-if="parts(palletCode).unit" class="cell-unit">{{ parts(palletCode).unit }}</text></text></view>
        </view>
        <!-- 本批状态：seg 双段（沿用现有控件） -->
        <view class="status-row">
            <text class="status-label">本批状态</text>
            <view class="status-options">
                <view class="status-item" :class="{ active: batchStatus === 'incomplete' }" @tap="!saving && $emit('update:batchStatus', 'incomplete')">未完成</view>
                <view class="status-item" :class="{ active: batchStatus === 'complete' }" @tap="!saving && $emit('update:batchStatus', 'complete')">已完成</view>
            </view>
        </view>
        <text class="sync-line">{{ offline ? '离线模式：只计算，不保存；登录后可保存与查询。' : '保存后自动同步云端' }}</text>
        <!-- 卡内三键：登录 保存/历史/清空；离线 保存(灰)/复制结果/清空 -->
        <view class="action-row">
            <button class="act primary" :class="{ 'offline-disabled': offline }" :disabled="saving || (!offline && !canSave)" @tap="$emit('save')">{{ saving ? '保存中…' : '保存' }}</button>
            <button v-if="!offline" class="act secondary" :disabled="saving" @tap="$emit('history')">历史</button>
            <button v-else class="act secondary" :disabled="saving" @tap="$emit('copy')">复制结果</button>
            <button class="act danger" :disabled="saving" @tap="$emit('clear')">清空</button>
        </view>
    </view>
</template>
<script>
export default {
    name: 'MesProdBody',
    props: {
        inboundCount: { type: String, default: '0 瓶' },
        sampleCount: { type: [String, Number], default: '' },
        innerIssued: { type: String, default: '0 瓶' },
        bucketCount: { type: Number, default: 0 },
        caseCountText: { type: String, default: '0' },
        palletCode: { type: String, default: '0 托' },
        batchStatus: { type: String, default: 'incomplete' },
        saving: Boolean,
        offline: Boolean,
        canSave: Boolean
    },
    methods: {
        /** 0 值（含 "0 瓶"/"0 托+0" 等格式）用中性灰，避免一屏重色块。 */
        isZero(value) {
            const text = String(value == null ? '' : value)
            return text === '0' || /^0(?:\s|$)/.test(text)
        },
        /** 长数值拆成「数字（44rpx）+ 单位/补充（26rpx）」，3 列窄格内不挤行、不丢信息。 */
        parts(value) {
            const text = String(value == null ? '' : value).trim()
            const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([\s\S]*)$/)
            if (!match) return { main: '', unit: text }
            return { main: match[1], unit: match[2].trim() }
        },
        onSample(e) {
            this.$emit('update:sampleCount', e.detail.value)
            this.$emit('change')
        }
    }
}
</script>
<style lang="scss" scoped>
.data-grid { display: flex; flex-wrap: wrap; margin: 0 -4rpx; }
.data-cell { box-sizing: border-box; flex: 0 0 calc(33.333% - 8rpx); min-width: 0; margin: 0 4rpx 8rpx; min-height: 104rpx; padding: 10rpx 12rpx; display: flex; flex-direction: column; justify-content: center; background: $surface; border: 1px solid $line; border-radius: 12rpx; }
.cell-label { font-size: 22rpx; color: $muted; line-height: 1.3; }
.cell-value { margin-top: 4rpx; display: flex; align-items: baseline; min-width: 0; font-weight: 700; line-height: 1.15; color: var(--state-primary, #{$primary}); overflow: hidden; white-space: nowrap; }
.cell-num { flex-shrink: 0; font-size: 44rpx; }
.cell-unit { flex-shrink: 0; margin-left: 4rpx; font-size: 26rpx; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.cell-value.zero { color: $muted; }
.cell-value.zero { color: $muted; }
.cell-input { box-sizing: border-box; width: 100%; height: 56rpx; margin-top: 2rpx; font-size: 32rpx; font-weight: 600; background: transparent; }
.cell-input[disabled] { color: $muted; }
.status-row { display: flex; align-items: center; margin-top: 6rpx; }
.status-label { flex-shrink: 0; margin-right: 12rpx; font-size: 24rpx; color: $muted; }
.status-options { flex: 1; display: flex; background: $canvas; border-radius: 12rpx; padding: 4rpx; }
.status-item { flex: 1; text-align: center; font-size: 26rpx; line-height: 64rpx; color: $muted; border-radius: 10rpx; }
.status-item.active { background: $primary; color: $surface; font-weight: 700; }
.sync-line { display: block; margin: 12rpx 0; font-size: 22rpx; color: $muted; }
.action-row { display: flex; }
.act { flex: 1; min-width: 0; margin: 0; padding: 0 8rpx; height: 80rpx; line-height: 80rpx; border-radius: 12rpx; font-size: 28rpx; font-weight: 600; }
.act + .act { margin-left: 12rpx; }
.act::after { border: 0; }
.act.primary { flex: 2; background: $primary; color: $surface; }
.act.secondary { background: $surface; color: $ink; border: 1px solid $line; }
.act.danger { background: mix($danger, $surface, 8%); color: $danger; }
.act[disabled] { opacity: .55; }
.offline-disabled { opacity: .45; }
</style>
