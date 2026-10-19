<template>
    <view class="ui-metric-strip" :style="{ gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))' }">
        <view v-for="(item, index) in items" :key="index" class="metric-cell" :class="['tone-' + (item.tone || 'neutral'), { clickable: item.clickable }]" @tap="pick(item)">
            <text class="metric-value">{{ item.value }}</text>
            <text class="metric-label">{{ item.label }}</text>
        </view>
    </view>
</template>
<script>
/** 关键数字条：2～4 格，tone 区分主色/警告/中性，clickable 加左侧强调条。 */
export default {
    name: 'MetricStrip',
    props: {
        items: { type: Array, default: () => [] },
        columns: { type: Number, default: 2 }
    },
    methods: { pick(item) { if (item.clickable) this.$emit('select', item) } }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-metric-strip { display: grid; gap: var(--sp-12, 12rpx); margin-bottom: var(--sp-12, 12rpx); }
.metric-cell { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2rpx; padding: var(--sp-16, 16rpx) var(--sp-20, 20rpx); border-radius: var(--radius-card, 16rpx); background: $surface; overflow: hidden; }
.metric-value { font-size: var(--fs-44, 44rpx); font-weight: 700; line-height: 1.1; color: $ink; }
.metric-label { font-size: var(--fs-24, 24rpx); color: $muted; line-height: 1.4; }
.metric-cell.tone-primary .metric-value { color: $primary; }
.metric-cell.tone-warning .metric-value { color: $warning; }
.metric-cell.tone-danger .metric-value { color: $danger; }
.metric-cell.clickable::before { content: ''; position: absolute; left: 0; top: var(--sp-16, 16rpx); bottom: var(--sp-16, 16rpx); width: 4rpx; border-radius: 2rpx; background: $primary; }
.metric-cell.clickable.tone-warning::before { background: $warning; }
.metric-cell.clickable.tone-danger::before { background: $danger; }
.metric-cell.clickable:active { background: $canvas; }
</style>
