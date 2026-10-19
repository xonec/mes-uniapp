<template>
    <view class="ui-action-bar">
        <button v-if="secondary" class="action-btn secondary" :disabled="busy || secondaryDisabled" @tap="$emit('secondary')">{{ secondary }}</button>
        <button class="action-btn primary" :disabled="busy || primaryDisabled" @tap="$emit('primary')">{{ primary }}</button>
        <button v-if="more" class="action-more" :disabled="busy" aria-label="更多" @tap="$emit('more')">⋯</button>
    </view>
</template>
<script>
/** 底部固定操作区：1 主 1 次 + 更多；页面根节点加 has-action-bar 自动预留 padding-bottom。 */
export default {
    name: 'ActionBar',
    props: {
        primary: { type: String, default: '' },
        secondary: { type: String, default: '' },
        primaryDisabled: { type: Boolean, default: false },
        secondaryDisabled: { type: Boolean, default: false },
        more: { type: Boolean, default: false },
        busy: { type: Boolean, default: false }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-action-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 80; display: flex; align-items: center; gap: var(--sp-12, 12rpx); padding: var(--sp-12, 12rpx) var(--sp-24, 24rpx) calc(var(--sp-12, 12rpx) + env(safe-area-inset-bottom)); background: $surface; border-top: 1px solid $line; }
.action-btn { margin: 0; height: 80rpx; line-height: 80rpx; padding: 0 var(--sp-24, 24rpx); border-radius: var(--radius-button, 12rpx); font-size: var(--fs-28, 28rpx); font-weight: 600; }
.action-btn::after { border: 0; }
.action-btn.primary { flex: 1; background: $primary; color: $surface; }
.action-btn.secondary { flex: 0 0 auto; background: $canvas; color: $ink; }
.action-btn[disabled], .action-more[disabled] { opacity: .6; }
.action-more { flex-shrink: 0; margin: 0; width: 80rpx; height: 80rpx; line-height: 80rpx; padding: 0; border-radius: var(--radius-button, 12rpx); background: $canvas; color: $ink; font-size: var(--fs-32, 32rpx); }
.action-more::after { border: 0; }
</style>
