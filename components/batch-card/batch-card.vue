<template>
    <view>
        <view class="batch-field"><text class="label">生产批号</text><view class="scan-input"><input class="input" maxlength="12" :disabled="disabled" placeholder="完整批号（含 B 单后缀），如 APDD26X1006" :value="batchNo" @input="$emit('update:batchNo', $event.detail.value)" /><button class="scan-button" :disabled="disabled" @tap="$emit('scan')">扫码</button></view></view>
        <view class="batch-field"><text class="label">产品编码<text v-if="productLocked" class="locked-note"> · 已关联订单</text></text><input class="input product-input" type="text" maxlength="10" :disabled="disabled || productLocked" placeholder="10 位产品编码" :value="productCode" @input="$emit('update:productCode', $event.detail.value)" /></view>
        <view class="actions"><button class="button primary" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || orderLoading" @tap="$emit('smart-fill')">{{ orderLoading ? '查询中…' : '按批号查询订单' }}</button><button v-if="!productLocked" class="button" :class="{ 'offline-disabled': offline }" :disabled="disabled" @tap="$emit('choose-product')">选择产品</button></view>
        <view class="fetch-area"><text class="label">每桶件数</text><view class="actions"><button class="button" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || cloudFetching" @tap="$emit('fetch-cloud')">{{ cloudFetching ? '获取中…' : '从云端获取' }}</button><button v-if="isAndroid" class="button" :class="{ 'offline-disabled': offline }" :disabled="disabled || !batchValid || fetching" @tap="$emit('fetch-fr')">{{ fetching ? '获取中…' : '从内网获取' }}</button></view><text class="fetch-note">{{ offline ? '登录后可用' : (!batchValid ? '填写完整批号后，可查询订单和每桶件数。' : frMsg || cloudMsg || '订单按完整批号匹配，请核对关联结果。') }}</text></view>
    </view>
</template>
<script>
export default {
    name: 'BatchCard',
    props: {
        productCode: { type: String, default: '' }, batchNo: { type: String, default: '' }, batchValid: Boolean,
        productLocked: Boolean, orderLoading: Boolean, disabled: Boolean,
        isAndroid: Boolean, cloudFetching: Boolean, fetching: Boolean,
        // 离线态：只置灰云端按钮（订单/云端/内网/选择产品），本地输入与扫码保持可用。
        // 不设原生 disabled（置灰按钮仍需可点击，由页面方法给出统一 toast 并拦截云调用）。
        offline: Boolean,
        frMsg: { type: String, default: '' }, cloudMsg: { type: String, default: '' }
    }
}
</script>
<style lang="scss" scoped>
.batch-field { margin-bottom: 20rpx; }.label { display: block; color: $muted; font-size: 24rpx; margin-bottom: 8rpx; }.locked-note { color: $primary; }
.input { flex: 1; min-width: 0; box-sizing: border-box; font-size: 28rpx; height: 92.8rpx; padding: 0 16rpx; background: $canvas; border-radius: 16rpx; }.product-input { width: 100%; }.scan-input { display: flex; align-items: center; }
.scan-input .scan-button { margin-left: 12rpx; }.scan-button { flex-shrink: 0; margin: 0; line-height: 92.8rpx; font-size: 28rpx; padding: 0 16rpx; background: $primary-soft; color: $primary; border-radius: 16rpx; }.scan-button::after, .button::after { border: 0; }
.actions { display: flex; }
.actions .button + .button { margin-left: 12rpx; }.button { flex: 1; min-width: 0; margin: 0; font-size: 28rpx; padding: 0 8rpx; line-height: 86.4rpx; border-radius: 16rpx; color: $primary; background: $primary-soft; }.button.primary { background: $primary; color: $surface; }.button[disabled], .scan-button[disabled] { color: $muted; background: $canvas; }
.offline-disabled { opacity: .45; }
.fetch-area { margin-top: 20rpx; padding-top: 20rpx; border-top: 1px solid $line; }.fetch-note { display: block; margin-top: 14rpx; font-size: 24rpx; color: $muted; line-height: 1.6; }
</style>
