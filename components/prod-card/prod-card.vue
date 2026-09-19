<template>
    <view>
        <view class="data-grid">
            <view class="data-cell"><text class="dlbl">入库瓶数</text><text class="dval">{{ inboundCount }}</text></view>
            <view class="data-cell">
                <text class="dlbl">取样数（瓶）</text>
                <input class="dinp" type="number" min="0" :value="sampleCount" @input="onSampleCount" />
            </view>
            <view class="data-cell"><text class="dlbl">领用内包数</text><text class="dval">{{ innerIssued }}</text></view>
            <view class="data-cell"><text class="dlbl">桶数</text><text class="dval">{{ bucketCount }}</text></view>
            <view class="data-cell"><text class="dlbl">入库数</text><text class="dval">{{ caseCountText }}</text></view>
            <view class="data-cell"><text class="dlbl">托码</text><text class="dval">{{ palletCode }}</text></view>
        </view>
        <view class="seg-row">
            <text class="dlbl">本批状态</text>
            <view class="seg">
                <view class="seg-item" :class="{ active: batchStatus === 'incomplete' }" @tap="$emit('update:batchStatus', 'incomplete')">未完成</view>
                <view class="seg-item" :class="{ active: batchStatus === 'complete' }" @tap="$emit('update:batchStatus', 'complete')">已完成</view>
            </view>
        </view>
        <view class="sync-line"><text>保存后自动同步云端</text></view>
        <view class="btn-row">
            <button class="btn primary" @tap="$emit('save')">保存</button>
            <button class="btn" @tap="$emit('history')">历史</button>
            <button class="btn danger" @tap="$emit('clear')">清空</button>
        </view>
    </view>
</template>

<script>
export default {
    name: 'ProdCard',
    props: {
        inboundCount: { type: String, default: '0 瓶' },
        sampleCount: { type: [String, Number], default: '' },
        innerIssued: { type: String, default: '0 瓶' },
        bucketCount: { type: Number, default: 0 },
        caseCountText: { type: String, default: '0' },
        palletCode: { type: String, default: '0 托' },
        batchStatus: { type: String, default: 'incomplete' }
    },
    methods: {
        onSampleCount(e) {
            this.$emit('update:sampleCount', e.detail.value)
            this.$emit('change')
        }
    }
}
</script>

<style scoped>
.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; }
.data-cell { background: #F7F9F8; border-radius: 12rpx; padding: 10rpx; min-height: 88rpx; display: flex; flex-direction: column; justify-content: center; }
.dlbl { font-size: 20rpx; color: #77827D; }
.dinp { margin-top: 4rpx; font-size: 26rpx; background: transparent; height: 40rpx; }
.dval { margin-top: 4rpx; font-size: 28rpx; font-weight: 700; color: #008577; }
.seg-row { display: flex; align-items: center; gap: 12rpx; margin: 6rpx 0 12rpx; }
.seg { flex: 1; display: flex; background: #F2F4F3; border-radius: 12rpx; padding: 4rpx; gap: 4rpx; }
.seg-item { flex: 1; text-align: center; font-size: 24rpx; color: #77827D; padding: 14rpx 0; border-radius: 10rpx; }
.seg-item.active { background: #008577; color: #fff; font-weight: 700; }
.sync-line { font-size: 20rpx; color: #77827D; margin: 12rpx 0; }
.btn-row { display: flex; gap: 12rpx; }
.btn-row .btn { flex: 1; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 18rpx; height: 64rpx; line-height: 64rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; }
.btn.danger { background: #FBEAE9; color: #D9534F; }
</style>
