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
.pager-summary { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin-bottom: .7rem; padding: .8rem; background: $canvas; border-radius: .5rem; font-size: .8rem; color: $muted; }.strong { font-weight: 700; font-size: .95rem; color: $ink; }.pager-actions { display: flex; flex-wrap: wrap; gap: .5rem; }.pager-actions .btn { flex: 1 1 40%; margin: 0; }.btn { font-size: .85rem; border-radius: .5rem; padding: 0 .6rem; line-height: 2.7rem; background: $primary-soft; color: $primary; }.btn::after { border: 0; }.btn.primary { background: $primary; color: $surface; }.btn[disabled] { color: $muted; background: $canvas; }.pending-note { padding: .85rem; margin-bottom: .8rem; background: mix($warning, $surface, 8%); color: $warning; font-size: .8rem; line-height: 1.6; border-radius: .5rem; }
</style>
