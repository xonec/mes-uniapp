<template>
    <view class="ui-step-bar">
        <view v-for="(step, index) in steps" :key="step" class="step-item" :class="{ active: index === current, complete: index < current, clickable: index < current }" @tap="pick(index)">
            <view class="step-dot"><uni-icons v-if="index < current" type="checkmarkempty" size="11" color="#008577"></uni-icons><text v-else class="step-dot-text">{{ index + 1 }}</text></view>
            <text class="step-label">{{ step }}</text>
            <view v-if="index < steps.length - 1" class="step-line" :class="{ done: index < current }" />
        </view>
    </view>
</template>
<script>
/** 三步流程条：当前步高亮、已完成打勾；点已完成步骤可回退（只 emit，由页面决定是否允许）。 */
export default {
    name: 'StepBar',
    props: {
        steps: { type: Array, default: () => [] },
        current: { type: Number, default: 0 }
    },
    methods: {
        pick(index) { if (index < this.current) this.$emit('select', index) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

/* 旧版微信 WebView 不支持 flex gap：统一用 margin 保持视觉不变 */
.ui-step-bar { display: flex; align-items: flex-start; padding: 0 0 var(--sp-16, 16rpx); }
.step-item + .step-item { margin-left: var(--sp-4, 4rpx); }
.step-item { flex: 1; min-width: 0; display: flex; align-items: center; position: relative; }
.step-dot { flex-shrink: 0; width: 40rpx; height: 40rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: $line; }
.step-dot-text { color: $muted; font-size: var(--fs-22, 22rpx); font-weight: 600; }
.step-label { margin-left: var(--sp-8, 8rpx); color: $muted; font-size: var(--fs-24, 24rpx); line-height: 1.3; white-space: nowrap; }
.step-item.active .step-dot { background: $primary; }
.step-item.active .step-dot-text { color: $surface; }
.step-item.active .step-label { color: $primary; font-weight: 600; }
.step-item.complete .step-dot { background: $primary-soft; }
.step-item.complete .step-dot-text { color: $primary; }
.step-item.complete .step-label { color: $ink; }
.step-item.clickable { opacity: .9; }
.step-line { flex: 1; height: 2rpx; min-width: 12rpx; margin-left: var(--sp-8, 8rpx); margin-right: var(--sp-4, 4rpx); background: $line; }
.step-line.done { background: $primary-soft; }
</style>
