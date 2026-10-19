<template>
    <view>
        <view v-if="pending" class="pending-note">上托要求尚未确认，补齐后可查看每托件号。</view>
        <view class="inline-field pager-summary"><text>件号</text><text class="strong">{{ palletRange }}</text></view>
        <view class="inline-field pager-summary" v-if="zeroBoxInfo && currentPallet === totalPallets"><text>零箱</text><text class="strong">{{ zeroBoxInfo }}</text></view>
        <view v-if="!pending" class="pager-actions">
            <button class="btn" :disabled="disabled || currentPallet <= 1" @tap="$emit('go', 'first')">首托</button>
            <button class="btn" :disabled="disabled || currentPallet <= 1" @tap="$emit('go', 'prev')">上一托</button>
            <button class="btn primary" :disabled="disabled || currentPallet >= totalPallets" @tap="$emit('go', 'next')">下一托</button>
            <button class="btn" :disabled="disabled || currentPallet >= totalPallets" @tap="$emit('go', 'last')">尾托</button>
        </view>
    </view>
</template>

<script>
export default {
    name: 'PalletCard',
    props: {
        palletRange: { type: String, default: '' },
        zeroBoxInfo: { type: String, default: '' },
        currentPallet: { type: Number, default: 1 },
        totalPallets: { type: Number, default: 1 },
        pending: Boolean, disabled: Boolean
    }
}
</script>

<style lang="scss" scoped>
.pager-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12rpx; margin-bottom: 14rpx; padding: 16rpx; background: $canvas; border-radius: 16rpx; font-size: 25.6rpx; color: $muted; }.strong { font-weight: 700; font-size: 30.4rpx; color: $ink; }.pager-actions { display: flex; flex-wrap: wrap; gap: 12rpx; }.pager-actions .btn { flex: 1 1 40%; margin: 0; }.btn { font-size: 27.2rpx; border-radius: 16rpx; padding: 0 12rpx; line-height: 86.4rpx; background: $primary-soft; color: $primary; }.btn::after { border: 0; }.btn.primary { background: $primary; color: $surface; }.btn[disabled] { color: $muted; background: $canvas; }.pending-note { padding: 18rpx; margin-bottom: 16rpx; background: mix($warning, $surface, 8%); color: $warning; font-size: 25.6rpx; line-height: 1.6; border-radius: 16rpx; }
</style>
