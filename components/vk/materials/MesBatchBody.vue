<template>
    <view>
        <!-- 产品编码 / 批号：右侧堆叠智能填充 + 选择产品 -->
        <view class="identity-row">
            <view class="identity-fields">
                <view class="field">
                    <text class="field-label">产品编码<text v-if="productLocked" class="locked-note"> · 已关联订单</text></text>
                    <input class="field-input" type="text" maxlength="10" :disabled="disabled || productLocked" placeholder="按批号前四位筛选" :value="productCode" @input="$emit('update:productCode', $event.detail.value)" />
                </view>
                <view class="field">
                    <text class="field-label">批号</text>
                    <view class="scan-row">
                        <input class="field-input" maxlength="12" :disabled="disabled" placeholder="完整批号（含 B 单后缀），如 APDD26X1006" :value="batchNo" @input="$emit('update:batchNo', $event.detail.value)" />
                        <button class="scan-btn" :disabled="disabled" aria-label="扫码录入批号" @tap="$emit('scan')"><uni-icons type="scan" size="18" color="#008577"></uni-icons></button>
                    </view>
                </view>
            </view>
            <view class="identity-actions">
                <button class="act primary" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || orderLoading" @tap="$emit('smart-fill')">{{ orderLoading ? '查询中…' : '智能填充' }}</button>
                <button class="act secondary" :class="{ 'offline-disabled': offline }" :disabled="disabled" @tap="$emit('choose-product')">选择产品</button>
            </view>
        </view>
        <!-- 每桶件数取数：云端 / 帆软(App)；右侧状态小字 -->
        <view class="fetch-row">
            <button class="fetch-btn primary-soft" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || cloudFetching" @tap="$emit('fetch-cloud')">{{ cloudFetching ? '获取中…' : '从云端获取每桶件数' }}</button>
            <button v-if="isAndroid" class="fetch-btn neutral" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || fetching" @tap="$emit('fetch-fr')">{{ fetching ? '获取中…' : '从帆软(内网)获取' }}</button>
            <text v-if="frMsg || cloudMsg" class="fetch-note">{{ frMsg || cloudMsg }}</text>
        </view>
        <!-- 极简订单行：有订单才显示内容（固定占位防跳动），点击查看摘要 -->
        <view class="order-line" :class="{ 'order-empty': !linkedOrder }" @tap="linkedOrder && $emit('view-order')">
            <template v-if="linkedOrder">
                <text class="order-text">订单 {{ linkedOrder.orderNo }} · V{{ linkedOrder.version || 1 }}</text>
                <text class="badge" :class="orderNotReady ? 'badge-warning' : 'badge-primary'">{{ orderNotReady ? '待确认' : '已确认' }}</text>
                <text class="order-extra" :class="{ warning: orderNotReady || palletPending }">{{ orderExtra }}</text>
                <text class="order-view">查看 ›</text>
            </template>
        </view>
    </view>
</template>
<script>
export default {
    name: 'MesBatchBody',
    props: {
        productCode: { type: String, default: '' },
        batchNo: { type: String, default: '' },
        batchValid: Boolean,
        productLocked: Boolean,
        orderLoading: Boolean,
        disabled: Boolean,
        isAndroid: Boolean,
        cloudFetching: Boolean,
        fetching: Boolean,
        frMsg: { type: String, default: '' },
        cloudMsg: { type: String, default: '' },
        offline: Boolean,
        linkedOrder: { type: Object, default: null },
        orderNotReady: Boolean,
        palletPending: Boolean,
        perPallet: { type: [String, Number], default: '' }
    },
    computed: {
        /** 订单行右侧的一句话状态：未确认 > 上托待确认 > 上托件数 */
        orderExtra() {
            if (this.orderNotReady) return '订单未确认，保存前需后台确认并启用'
            if (this.palletPending) return '上托待确认 · 暂不计算托数'
            return '上托 ' + (this.perPallet || '—') + ' 件 / 托'
        }
    }
}
</script>
<style lang="scss" scoped>
.identity-row { display: flex; align-items: stretch; }
.identity-fields { flex: 1; min-width: 0; }
.field { display: flex; align-items: center; }
.field + .field { margin-top: 12rpx; }
.field-label { flex-shrink: 0; margin-right: 12rpx; font-size: 24rpx; color: $muted; line-height: 1.4; white-space: nowrap; }
.locked-note { color: $primary; }
.field-input { box-sizing: border-box; flex: 1; min-width: 0; height: 80rpx; padding: 0 16rpx; font-size: 30rpx; background: $surface; border-radius: 12rpx; }
.scan-row { flex: 1; min-width: 0; display: flex; align-items: center; }
.scan-row .field-input { flex: 1; min-width: 0; }
.scan-btn { flex-shrink: 0; width: 80rpx; height: 80rpx; margin: 0 0 0 8rpx; padding: 0; display: flex; align-items: center; justify-content: center; background: $surface; border-radius: 12rpx; }
.scan-btn::after, .act::after, .fetch-btn::after { border: 0; }
.identity-actions { flex-shrink: 0; width: 176rpx; margin-left: 12rpx; display: flex; flex-direction: column; justify-content: center; }
.act { box-sizing: border-box; width: 100%; margin: 0; padding: 0 8rpx; border-radius: 12rpx; font-size: 26rpx; font-weight: 600; line-height: 80rpx; }
.act + .act { margin-top: 12rpx; }
.act.primary { background: $primary; color: $surface; }
.act.secondary { background: $surface; color: $ink; }
.act[disabled] { opacity: .55; }
.fetch-row { display: flex; flex-wrap: wrap; align-items: center; margin-top: 12rpx; }
.fetch-btn { margin: 0; padding: 0 16rpx; line-height: 72rpx; border-radius: 12rpx; font-size: 24rpx; }
.fetch-btn + .fetch-btn { margin-left: 12rpx; }
.fetch-btn.primary-soft { background: $primary-soft; color: var(--state-primary, #{$primary}); }
.fetch-btn.neutral { background: $canvas; color: $ink; }
.fetch-btn[disabled] { opacity: .55; }
.fetch-note { margin-left: auto; padding-left: 12rpx; font-size: 22rpx; color: $muted; line-height: 1.4; text-align: right; }
.order-line { display: flex; align-items: center; min-height: 44rpx; margin-top: 12rpx; padding: 0 4rpx; }
.order-empty { visibility: hidden; }
.order-text { font-size: 24rpx; color: $ink; font-weight: 600; }
.badge { margin-left: 12rpx; flex-shrink: 0; font-size: 22rpx; line-height: 1.4; padding: 2rpx 10rpx; border-radius: 8rpx; }
.badge-primary { color: var(--state-primary, #{$primary}); background: $primary-soft; }
.badge-warning { color: $warning; background: mix($warning, $surface, 10%); }
.order-extra { margin-left: 12rpx; flex: 1; min-width: 0; font-size: 22rpx; color: $muted; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.order-extra.warning { color: $warning; }
.order-view { flex-shrink: 0; margin-left: 8rpx; font-size: 22rpx; color: $primary; }
.offline-disabled { opacity: .45; }
</style>
