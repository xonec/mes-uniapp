<template>
    <view>
        <view class="cmd-grid">
            <view class="cmd-info">
                <view class="inline-field">
                    <text class="lbl">产品编码</text>
                    <input class="inp" type="text" maxlength="10"
                        placeholder="按批号前四位筛选" :value="productCode" @input="$emit('update:productCode', $event.detail.value)" />
                </view>
                <view class="inline-field">
                    <text class="lbl">批号</text>
                    <view class="scan-input">
                        <input class="inp" type="text" maxlength="11"
                            placeholder="11位英文+数字" :value="batchNo" @input="$emit('update:batchNo', $event.detail.value)" />
                        <button class="scan-mini" @tap="$emit('scan')" aria-label="扫码">⊞</button>
                    </view>
                </view>
            </view>
            <view class="cmd-actions">
                <button class="btn primary" @tap="$emit('smart-fill')">智能填充</button>
                <button class="btn" @tap="$emit('choose-product')">选择产品</button>
            </view>
        </view>
        <view class="fr-bar">
            <button class="btn cloud-btn" :disabled="!batchValid || cloudFetching" @tap="$emit('fetch-cloud')">
                {{ cloudFetching ? '获取中…' : '从云端获取每桶件数' }}
            </button>
            <button v-if="isAndroid" class="btn fr-btn" :disabled="!batchValid || fetching" @tap="$emit('fetch-fr')">
                {{ fetching ? '获取中…' : '从帆软(内网)获取' }}
            </button>
            <text class="fr-hint" v-if="!batchValid">输入有效批号后可用</text>
            <text class="fr-hint" v-else-if="frMsg">{{ frMsg }}</text>
            <text class="fr-hint" v-else-if="cloudMsg">{{ cloudMsg }}</text>
        </view>
    </view>
</template>

<script>
export default {
    name: 'BatchCard',
    props: {
        productCode: { type: String, default: '' },
        batchNo: { type: String, default: '' },
        batchValid: { type: Boolean, default: false },
        isAndroid: { type: Boolean, default: false },
        cloudFetching: { type: Boolean, default: false },
        fetching: { type: Boolean, default: false },
        frMsg: { type: String, default: '' },
        cloudMsg: { type: String, default: '' }
    }
}
</script>

<style scoped>
.cmd-grid { display: flex; justify-content: space-between; align-items: flex-end; }
.cmd-info { flex: 1; }
.inline-field { display: flex; align-items: center; margin-bottom: 10rpx; background: #F4F7F6; border-radius: 12rpx; padding: 0 14rpx; height: 64rpx; }
.lbl { font-size: 22rpx; color: #77827D; width: 110rpx; flex-shrink: 0; }
.inp { flex: 1; height: 64rpx; font-size: 26rpx; background: transparent; }
.scan-input { display: flex; align-items: center; flex: 1; }
.scan-mini { width: 56rpx; height: 56rpx; margin-left: 8rpx; border-radius: 10rpx; background: #008577; color: #fff; font-size: 28rpx; line-height: 56rpx; padding: 0; }
.cmd-actions { display: flex; flex-direction: column; margin-left: 12rpx; }
.btn { font-size: 24rpx; border-radius: 12rpx; padding: 0 18rpx; height: 64rpx; line-height: 64rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; }
.fr-bar { margin-top: 12rpx; display: flex; align-items: center; flex-wrap: wrap; }
.fr-btn { background: #E6F4F1; color: #008577; height: 60rpx; line-height: 60rpx; }
.cloud-btn { background: #E8F0FE; color: #2F5597; height: 60rpx; line-height: 60rpx; }
.fr-hint { font-size: 20rpx; color: #77827D; margin-left: 12rpx; }
</style>
