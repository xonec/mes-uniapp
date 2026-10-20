<template>
    <view class="ui-list-row" hover-class="list-row-hover" @tap="$emit('select')">
        <view class="list-row-main">
            <view class="list-row-title-line">
                <text v-if="tag" class="list-row-tag">{{ tag }}</text>
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
            <text v-if="preview" class="list-row-preview">{{ preview }}</text>
            <text v-if="action" class="list-row-action">{{ action }}</text>
        </view>
    </view>
</template>
<script>
/**
 * 列表行：主标题（可带 tag 小标签）+ 一行元信息（批号 mono · 工序车间）
 * + 右侧状态徽标 + 可选进度条 / 两行摘要 preview / 行内动作提示 action。整行可点。
 */
export default {
    name: 'ListRow',
    props: {
        title: { type: String, default: '' },
        tag: { type: String, default: '' },
        code: { type: String, default: '' },
        meta: { type: String, default: '' },
        badge: { type: String, default: '' },
        badgeTone: { type: String, default: 'neutral' },
        progress: { type: Number, default: null },
        progressText: { type: String, default: '' },
        progressTone: { type: String, default: 'primary' },
        preview: { type: String, default: '' },
        action: { type: String, default: '' }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';

.ui-list-row { padding: var(--sp-16, 16rpx) var(--sp-20, 20rpx); background: $surface; border-radius: var(--radius-card, 16rpx); }
.list-row-hover { background: $primary-soft; }
.list-row-main { min-width: 0; }
/* 旧版微信 WebView 不支持 flex gap：统一用 margin 保持视觉不变 */
.list-row-title-line { display: flex; align-items: center; justify-content: space-between; }
.list-row-title-line .fw-badge { margin-left: var(--sp-12, 12rpx); }
.list-row-tag { flex-shrink: 0; margin-right: var(--sp-12, 12rpx); padding: 2rpx var(--sp-8, 8rpx); border-radius: var(--radius-badge, 8rpx); background: $primary-soft; color: #0B7263; font-size: var(--fs-22, 22rpx); line-height: 1.4; }
.list-row-title { flex: 1; min-width: 0; font-size: var(--fs-28, 28rpx); font-weight: 600; line-height: 1.4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.list-row-meta-line { display: flex; align-items: baseline; margin-top: 2rpx; min-width: 0; }
.list-row-code { flex-shrink: 0; font-family: monospace; font-size: var(--fs-24, 24rpx); color: $muted; }
.list-row-dot { flex-shrink: 0; margin: 0 var(--sp-8, 8rpx); color: $muted; font-size: var(--fs-22, 22rpx); }
.list-row-meta { min-width: 0; color: $muted; font-size: var(--fs-24, 24rpx); line-height: 1.4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.list-row-progress { display: flex; align-items: center; margin-top: var(--sp-8, 8rpx); }
.list-row-track { flex: 1; height: 6rpx; border-radius: 999rpx; background: $canvas; overflow: hidden; }
.list-row-bar { display: block; height: 100%; border-radius: 999rpx; background: var(--state-primary, #0B7263); }
.list-row-bar.tone-warning { background: $warning; }
.list-row-bar.tone-neutral { background: $muted; }
.list-row-bar.tone-danger { background: $danger; }
.list-row-progress-text { flex-shrink: 0; margin-left: var(--sp-12, 12rpx); color: $muted; font-size: var(--fs-22, 22rpx); }
.list-row-preview { display: -webkit-box; margin-top: var(--sp-4, 4rpx); overflow: hidden; color: $muted; font-size: var(--fs-24, 24rpx); line-height: 1.5; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.list-row-action { display: block; margin-top: var(--sp-4, 4rpx); text-align: right; color: #0B7263; font-size: var(--fs-24, 24rpx); }
</style>
