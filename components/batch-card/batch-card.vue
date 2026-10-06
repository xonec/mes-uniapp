<template>
    <view>
        <view class="batch-field"><text class="label">生产批号</text><view class="scan-input"><input class="input" maxlength="11" :disabled="disabled" placeholder="完整 11 位批号，如 APDD26X1006" :value="batchNo" @input="$emit('update:batchNo', $event.detail.value)" /><button class="scan-button" :disabled="disabled" @tap="$emit('scan')">扫码</button></view></view>
        <view class="batch-field"><text class="label">产品编码<text v-if="productLocked" class="locked-note"> · 已关联订单</text></text><input class="input product-input" type="text" maxlength="10" :disabled="disabled || productLocked" placeholder="10 位产品编码" :value="productCode" @input="$emit('update:productCode', $event.detail.value)" /></view>
        <view class="actions"><button class="button primary" :disabled="disabled || !batchValid || orderLoading" @tap="$emit('smart-fill')">{{ orderLoading ? '查询中…' : '按批号查询订单' }}</button><button v-if="!productLocked" class="button" :disabled="disabled" @tap="$emit('choose-product')">选择产品</button></view>
        <view class="fetch-area"><text class="label">每桶件数</text><view class="actions"><button class="button" :disabled="disabled || !batchValid || cloudFetching" @tap="$emit('fetch-cloud')">{{ cloudFetching ? '获取中…' : '从云端获取' }}</button><button v-if="isAndroid" class="button" :disabled="disabled || !batchValid || fetching" @tap="$emit('fetch-fr')">{{ fetching ? '获取中…' : '从内网获取' }}</button></view><text class="fetch-note">{{ !batchValid ? '填写完整批号后，可查询订单和每桶件数。' : frMsg || cloudMsg || '订单按完整批号匹配，请核对关联结果。' }}</text></view>
    </view>
</template>
<script>
export default {
    name: 'BatchCard',
    props: {
        productCode: { type: String, default: '' }, batchNo: { type: String, default: '' }, batchValid: Boolean,
        productLocked: Boolean, orderLoading: Boolean, disabled: Boolean,
        isAndroid: Boolean, cloudFetching: Boolean, fetching: Boolean,
        frMsg: { type: String, default: '' }, cloudMsg: { type: String, default: '' }
    }
}
</script>
<style lang="scss" scoped>
.batch-field { margin-bottom: .9rem; }.label { display: block; color: $muted; font-size: .8rem; margin-bottom: .4rem; }.locked-note { color: $primary; }
.input { flex: 1; min-width: 0; box-sizing: border-box; font-size: .9rem; height: 2.9rem; padding: 0 .75rem; background: $canvas; border-radius: .5rem; }.product-input { width: 100%; }.scan-input { display: flex; align-items: center; gap: .5rem; }.scan-button { flex-shrink: 0; margin: 0; line-height: 2.9rem; font-size: .85rem; padding: 0 .8rem; background: $primary-soft; color: $primary; border-radius: .5rem; }.scan-button::after, .button::after { border: 0; }
.actions { display: flex; gap: .6rem; }.button { flex: 1; min-width: 0; margin: 0; font-size: .85rem; padding: 0 .4rem; line-height: 2.7rem; border-radius: .5rem; color: $primary; background: $primary-soft; }.button.primary { background: $primary; color: $surface; }.button[disabled], .scan-button[disabled] { color: $muted; background: $canvas; }
.fetch-area { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid $line; }.fetch-note { display: block; margin-top: .7rem; font-size: .75rem; color: $muted; line-height: 1.6; }
</style>
