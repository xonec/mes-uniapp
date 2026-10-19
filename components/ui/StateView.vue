<template>
    <view class="ui-state-view">
        <view v-if="state === 'loading'" class="state-skeleton">
            <view v-for="n in rows" :key="n" class="state-skeleton-row">
                <view class="state-sk w45" />
                <view class="state-sk w30" />
                <view class="state-sk w70" />
            </view>
        </view>
        <view v-else-if="state === 'empty'" class="state-empty">
            <text class="state-empty-icon">{{ icon }}</text>
            <text class="state-empty-title">{{ title }}</text>
            <text v-if="reason" class="state-empty-reason">{{ reason }}</text>
        </view>
        <view v-else-if="state === 'more'" class="state-more">
            <text class="state-more-dot" />
            <text class="state-more-dot" />
            <text class="state-more-dot" />
            <text class="state-more-text">{{ moreText }}</text>
        </view>
    </view>
</template>
<script>
/** 三态合一：loading 骨架 3 行 / empty 图标+结论+原因 / more 上滑加载一行。 */
export default {
    name: 'StateView',
    props: {
        state: { type: String, default: '' },
        title: { type: String, default: '' },
        reason: { type: String, default: '' },
        icon: { type: String, default: '▤' },
        rows: { type: Number, default: 3 },
        moreText: { type: String, default: '正在加载更多…' }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.state-skeleton { display: flex; flex-direction: column; gap: var(--sp-12, 12rpx); }
.state-skeleton-row { display: flex; flex-direction: column; gap: var(--sp-8, 8rpx); padding: var(--sp-16, 16rpx) var(--sp-20, 20rpx); border-radius: var(--radius-card, 16rpx); background: $surface; }
.state-sk { height: var(--fs-24, 24rpx); border-radius: var(--radius-badge, 8rpx); background: $line; }
.state-sk.w30 { width: 30%; }
.state-sk.w45 { width: 45%; }
.state-sk.w70 { width: 70%; }
.state-empty { display: flex; flex-direction: column; align-items: center; gap: var(--sp-4, 4rpx); padding: 48rpx var(--sp-24, 24rpx); background: $surface; border-radius: var(--radius-card, 16rpx); }
.state-empty-icon { width: 80rpx; height: 80rpx; margin-bottom: var(--sp-8, 8rpx); border-radius: 50%; background: $canvas; color: $muted; font-size: var(--fs-32, 32rpx); line-height: 80rpx; text-align: center; }
.state-empty-title { font-size: var(--fs-28, 28rpx); font-weight: 600; color: $ink; }
.state-empty-reason { font-size: var(--fs-24, 24rpx); color: $muted; line-height: 1.5; text-align: center; }
.state-more { display: flex; align-items: center; justify-content: center; gap: var(--sp-8, 8rpx); padding: var(--sp-20, 20rpx) 0 var(--sp-8, 8rpx); }
.state-more-dot { width: 8rpx; height: 8rpx; border-radius: 50%; background: $muted; opacity: .55; }
.state-more-text { margin-left: var(--sp-4, 4rpx); font-size: var(--fs-24, 24rpx); color: $muted; }
</style>
