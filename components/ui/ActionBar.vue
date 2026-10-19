<template>
    <view class="ui-action-bar">
        <text v-if="note" class="action-note">{{ note }}</text>
        <view class="action-row">
            <button v-if="secondary" class="action-btn secondary" :disabled="busy || secondaryDisabled" @tap="$emit('secondary')">{{ secondary }}</button>
            <button class="action-btn primary" :disabled="busy || primaryDisabled" @tap="$emit('primary')">{{ primary }}</button>
            <button v-if="more" class="action-more" :disabled="busy" aria-label="更多" @tap="$emit('more')"><uni-icons type="more-filled" size="18" color="#1F2622"></uni-icons></button>
        </view>
    </view>
</template>
<script>
/** 底部固定操作区：可选一行提示 + 1 主 1 次 + 更多；页面根节点加 has-action-bar 自动预留 padding-bottom。 */
export default {
    name: 'ActionBar',
    props: {
        primary: { type: String, default: '' },
        secondary: { type: String, default: '' },
        note: { type: String, default: '' },
        primaryDisabled: { type: Boolean, default: false },
        secondaryDisabled: { type: Boolean, default: false },
        more: { type: Boolean, default: false },
        busy: { type: Boolean, default: false }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-action-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 80; padding: var(--sp-8, 8rpx) var(--sp-24, 24rpx) calc(var(--sp-12, 12rpx) + env(safe-area-inset-bottom)); background: $surface; border-top: 1px solid $line; }
.action-note { display: block; margin-bottom: var(--sp-6, 6rpx); color: $muted; font-size: var(--fs-22, 22rpx); line-height: 1.4; }
/* 旧版微信 WebView 不支持 flex gap：统一用 margin 保持视觉不变 */
.action-row { display: flex; align-items: center; }
.action-row .action-btn + .action-btn, .action-row .action-btn + .action-more { margin-left: var(--sp-12, 12rpx); }
.action-btn { margin: 0; height: 80rpx; line-height: 80rpx; padding: 0 var(--sp-24, 24rpx); border-radius: var(--radius-button, 12rpx); font-size: var(--fs-28, 28rpx); font-weight: 600; }
.action-btn::after { border: 0; }
.action-btn.primary { flex: 1; background: $primary; color: $surface; }
.action-btn.secondary { flex: 0 0 auto; background: $canvas; color: $ink; }
.action-btn[disabled], .action-more[disabled] { opacity: .6; }
.action-more { flex-shrink: 0; margin: 0; width: 80rpx; height: 80rpx; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-button, 12rpx); background: $canvas; }
.action-more::after { border: 0; }
</style>
