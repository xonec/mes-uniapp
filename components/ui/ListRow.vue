<template>
    <view class="ui-list-row" hover-class="list-row-hover" @tap="$emit('select')">
        <view class="list-row-main">
            <view class="list-row-title-line">
                <text class="list-row-title">{{ title }}</text>
                <text v-if="badge" class="fw-badge" :class="'tone-' + (badgeTone || 'neutral')">{{ badge }}</text>
            </view>
            <view v-if="code || meta" class="list-row-meta-line">
                <text v-if="code" class="list-row-code">{{ code }}</text>
                <text v-if="code && meta" class="list-row-dot">·</text>
                <text v-if="meta" class="list-row-meta">{{ meta }}</text>
            </view>
            <view v-if="progress !== null" class="list-row-progress">
                <view class="list-row-track">
                    <view class="list-row-bar" :class="'tone-' + (progressTone || 'primary')" :style="{ width: progress + '%' }" />
                </view>
                <text class="list-row-progress-text">{{ progressText }}</text>
            </view>
        </view>
    </view>
</template>
<script>
/** 列表行：主标题 + 一行元信息（批号 mono · 工序车间）+ 右侧状态徽标 + 可选进度条。整行可点。 */
export default {
    name: 'ListRow',
    props: {
        title: { type: String, default: '' },
        code: { type: String, default: '' },
        meta: { type: String, default: '' },
        badge: { type: String, default: '' },
        badgeTone: { type: String, default: 'neutral' },
        progress: { type: Number, default: null },
        progressText: { type: String, default: '' },
        progressTone: { type: String, default: 'primary' }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-list-row { padding: var(--sp-16, 16rpx) var(--sp-20, 20rpx); background: $surface; border-radius: var(--radius-card, 16rpx); }
.list-row-hover { background: $primary-soft; }
.list-row-main { min-width: 0; }
.list-row-title-line { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-12, 12rpx); }
.list-row-title { flex: 1; min-width: 0; font-size: var(--fs-28, 28rpx); font-weight: 600; line-height: 1.4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.list-row-meta-line { display: flex; align-items: baseline; gap: var(--sp-8, 8rpx); margin-top: 2rpx; min-width: 0; }
.list-row-code { flex-shrink: 0; font-family: monospace; font-size: var(--fs-24, 24rpx); color: $muted; }
.list-row-dot { flex-shrink: 0; color: $muted; font-size: var(--fs-22, 22rpx); }
.list-row-meta { min-width: 0; color: $muted; font-size: var(--fs-24, 24rpx); line-height: 1.4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.list-row-progress { display: flex; align-items: center; gap: var(--sp-12, 12rpx); margin-top: var(--sp-8, 8rpx); }
.list-row-track { flex: 1; height: 6rpx; border-radius: 999rpx; background: $canvas; overflow: hidden; }
.list-row-bar { display: block; height: 100%; border-radius: 999rpx; background: $primary; }
.list-row-bar.tone-warning { background: $warning; }
.list-row-bar.tone-neutral { background: $muted; }
.list-row-bar.tone-danger { background: $danger; }
.list-row-progress-text { flex-shrink: 0; color: $muted; font-size: var(--fs-22, 22rpx); }
</style>
