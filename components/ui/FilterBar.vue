<template>
    <view class="ui-filter-bar">
        <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
            <view class="filter-row">
                <text v-for="item in items" :key="item.value" class="filter-chip" :class="{ active: item.value === value }" @tap="$emit('change', item.value)">{{ item.name }}</text>
            </view>
        </scroll-view>
        <view v-if="search" class="filter-icon" aria-label="搜索" @tap="$emit('search')">
            <text class="filter-glyph">⌕</text>
        </view>
    </view>
</template>
<script>
/** 横滑筛选 chips；search=true 时右侧折叠一个搜索图标。 */
export default {
    name: 'FilterBar',
    props: {
        items: { type: Array, default: () => [] },
        value: { type: String, default: '' },
        search: { type: Boolean, default: false }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-filter-bar { display: flex; align-items: center; gap: var(--sp-8, 8rpx); margin-bottom: var(--sp-12, 12rpx); }
.filter-scroll { flex: 1; min-width: 0; white-space: nowrap; }
.filter-row { display: flex; align-items: center; gap: var(--sp-8, 8rpx); }
.filter-chip { flex-shrink: 0; padding: var(--sp-8, 8rpx) var(--sp-20, 20rpx); border-radius: var(--radius-badge, 8rpx); border: 1px solid $line; background: $surface; color: $muted; font-size: var(--fs-24, 24rpx); line-height: 1.4; }
.filter-chip.active { background: $primary; border-color: $primary; color: $surface; font-weight: 600; }
.filter-icon { flex-shrink: 0; width: 60rpx; height: 60rpx; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-button, 12rpx); background: $surface; border: 1px solid $line; }
.filter-glyph { color: $muted; font-size: var(--fs-28, 28rpx); line-height: 1; }
</style>
