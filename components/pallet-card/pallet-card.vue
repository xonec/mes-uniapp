<template>
    <view>
        <view class="inline-field pager-summary"><text>件号</text><text class="strong">{{ palletRange }}</text></view>
        <view class="inline-field pager-summary" v-if="zeroBoxInfo && currentPallet === totalPallets"><text>零箱</text><text class="strong">{{ zeroBoxInfo }}</text></view>
        <view class="pager-actions">
            <button class="btn" @tap="$emit('go', 'first')">首托</button>
            <button class="btn" @tap="$emit('go', 'prev')">上一托</button>
            <button class="btn primary" @tap="$emit('go', 'next')">下一托</button>
            <button class="btn" @tap="$emit('go', 'last')">尾托</button>
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
        totalPallets: { type: Number, default: 1 }
    }
}
</script>

<style scoped>
.inline-field.pager-summary { display: flex; align-items: center; gap: 12rpx; margin-bottom: 10rpx; }
.strong { font-weight: 700; font-size: 26rpx; }
.pager-actions { display: flex; gap: 10rpx; }
.pager-actions .btn { flex: 1; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 18rpx; height: 64rpx; line-height: 64rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; }
</style>
