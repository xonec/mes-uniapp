<template>
    <view class="ui-page-head">
        <view class="page-head-main">
            <view class="page-head-line">
                <text v-if="title" class="page-head-title">{{ title }}</text>
                <text v-if="badge" class="fw-badge" :class="'tone-' + (badgeTone || 'primary')">{{ badge }}</text>
            </view>
            <text v-if="subtitle" class="page-head-sub">{{ subtitle }}</text>
        </view>
        <view v-if="refresh || more" class="page-head-actions">
            <view v-if="refresh" class="page-head-icon" aria-label="刷新" @tap="$emit('refresh')">
                <uni-icons type="refresh" size="16" color="#008577"></uni-icons>
            </view>
            <view v-if="more" class="page-head-icon" aria-label="更多" @tap="$emit('more')">
                <uni-icons type="more-filled" size="16" color="#008577"></uni-icons>
            </view>
        </view>
    </view>
</template>
<script>
/** 页内标题行：左标题/状态徽标 + 右刷新/更多小图标，替代整宽按钮。 */
export default {
    name: 'PageHead',
    props: {
        title: { type: String, default: '' },
        subtitle: { type: String, default: '' },
        badge: { type: String, default: '' },
        badgeTone: { type: String, default: 'primary' },
        refresh: { type: Boolean, default: false },
        more: { type: Boolean, default: false }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

/* 旧版微信 WebView 不支持 flex/grid gap：统一用 margin 保持视觉不变 */
.ui-page-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-12, 12rpx); }
.page-head-main { min-width: 0; flex: 1; }
.page-head-line { display: flex; align-items: center; min-width: 0; }
.page-head-line .fw-badge { margin-left: var(--sp-8, 8rpx); }
.page-head-title { font-size: var(--fs-30, 30rpx); font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.page-head-sub { display: block; margin-top: 2rpx; color: $muted; font-size: var(--fs-22, 22rpx); line-height: 1.4; }
.page-head-actions { display: flex; align-items: center; flex-shrink: 0; margin-left: var(--sp-12, 12rpx); }
.page-head-icon + .page-head-icon { margin-left: var(--sp-8, 8rpx); }
.page-head-icon { width: 72rpx; height: 72rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: $canvas; }
</style>
