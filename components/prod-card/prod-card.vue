<template>
    <view :class="{ 'legacy-layout': legacyLayout }">
        <view class="data-grid">
            <view class="data-cell"><text class="dlbl">入库瓶数</text><text class="dval">{{ inboundCount }}</text></view>
            <view class="data-cell">
                <text class="dlbl">取样数（瓶）</text>
                <input class="dinp" :disabled="saving" type="number" min="0" :value="sampleCount" @input="onSampleCount" />
            </view>
            <view class="data-cell"><text class="dlbl">领用内包数</text><text class="dval">{{ innerIssued }}</text></view>
            <view class="data-cell"><text class="dlbl">桶数</text><text class="dval">{{ bucketCount }}</text></view>
            <view class="data-cell"><text class="dlbl">入库数</text><text class="dval">{{ caseCountText }}</text></view>
            <view class="data-cell"><text class="dlbl">托码</text><text class="dval">{{ palletCode }}</text></view>
        </view>
        <view class="seg-row">
            <text class="dlbl">本批状态</text>
            <view class="seg">
                <view class="seg-item" :class="{ active: batchStatus === 'incomplete' }" @tap="!saving && $emit('update:batchStatus', 'incomplete')">未完成</view>
                <view class="seg-item" :class="{ active: batchStatus === 'complete' }" @tap="!saving && $emit('update:batchStatus', 'complete')">已完成</view>
            </view>
        </view>
        <view v-if="!hideActions" class="sync-line"><text>保存后自动同步云端</text></view>
        <view class="btn-row">
            <button v-if="!hideActions" class="btn primary" :disabled="saving" @tap="$emit('save')">保存</button>
            <button v-if="!hideActions" class="btn" :disabled="saving" @tap="$emit('history')">历史</button>
            <button class="btn danger" :disabled="saving" @tap="confirmClear">清空当前计算</button>
        </view>
    </view>
</template>

<script>
export default {
    name: 'ProdCard',
    props: {
        hideActions: Boolean, saving: Boolean, legacyLayout: Boolean,
        inboundCount: { type: String, default: '0 瓶' },
        sampleCount: { type: [String, Number], default: '' },
        innerIssued: { type: String, default: '0 瓶' },
        bucketCount: { type: Number, default: 0 },
        caseCountText: { type: String, default: '0' },
        palletCode: { type: String, default: '0 托' },
        batchStatus: { type: String, default: 'incomplete' }
    },
    methods: {
        confirmClear() { if (this.saving) return; uni.showModal({ title: '清空当前计算', content: '确认清空本页填写内容？已保存的历史记录会保留。', success: result => { if (result.confirm) this.$emit('clear') } }) },
        onSampleCount(e) {
            this.$emit('update:sampleCount', e.detail.value)
            this.$emit('change')
        }
    }
}
</script>

<style lang="scss" scoped>
.data-grid { display: flex; flex-wrap: wrap; margin: 0 -6rpx; }
.data-grid .data-cell { box-sizing: border-box; flex: 0 0 calc(50% - 12rpx); margin: 0 6rpx 12rpx; }
.data-cell { background: $canvas; border-radius: 12rpx; padding: 16rpx; min-height: 112rpx; display: flex; flex-direction: column; justify-content: center; }
.dlbl { font-size: 24rpx; color: $muted; }
.dinp { margin-top: 4rpx; font-size: 28rpx; background: transparent; height: 73.6rpx; }
.dval { margin-top: 4rpx; font-size: 32rpx; font-weight: 700; color: $primary; }
// 安卓 App 恢复原有三列生产数据布局。
.legacy-layout {
    .data-grid .data-cell { flex-basis: calc(33.333% - 12rpx); }
    .data-cell { min-width: 0; padding: 10rpx; min-height: 88rpx; }
    .dlbl { font-size: 22rpx; }
    .dinp { min-width: 0; height: 40rpx; font-size: 26rpx; }
    .dval { font-size: 28rpx; }
}
.seg-row { display: flex; align-items: center; margin: 6rpx 0 12rpx; }
.seg-row .seg { margin-left: 12rpx; }
.seg { flex: 1; display: flex; background: $canvas; border-radius: 12rpx; padding: 4rpx; }
.seg .seg-item + .seg-item { margin-left: 4rpx; }
.seg-item { flex: 1; text-align: center; font-size: 24rpx; color: $muted; padding: 14rpx 0; border-radius: 10rpx; }
.seg-item.active { background: $primary; color: $surface; font-weight: 700; }
.sync-line { font-size: 24rpx; color: $muted; margin: 12rpx 0; }
.btn-row { display: flex; }
.btn-row .btn + .btn { margin-left: 12rpx; }
.btn-row .btn { flex: 1; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 12rpx; height: 64rpx; line-height: 64rpx; background: $canvas; color: $ink; }
.btn.primary { background: $primary; color: $surface; }
.btn.danger { background: mix($danger, $surface, 8%); color: $danger; }
</style>
