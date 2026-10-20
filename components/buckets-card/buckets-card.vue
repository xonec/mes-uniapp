<template>
    <view :class="{ 'legacy-layout': legacyLayout }">
        <view class="bucket-grid">
            <view class="bucket" v-for="(key, idx2) in bucketKeys" :key="key">
                <text class="blbl">{{ key }}桶</text>
                <input class="binp" type="number" min="0" :disabled="disabled || isBucketDisabled(idx2)"
                    :placeholder="'0'" :value="buckets[key]" @input="onBucket(key, $event)" />
            </view>
        </view>
        <view class="data-grid bucket-tail">
            <view class="data-cell">
                <text class="dlbl">零箱（瓶）</text>
                <input class="dinp" type="number" min="0" :disabled="disabled" :value="zeroCount" @input="onField('zeroCount', $event)" />
            </view>
            <view class="data-cell">
                <text class="dlbl">瓶 / 件</text>
                <input class="dinp" type="number" min="1" :disabled="disabled" :value="perCase" @input="onField('perCase', $event)" />
            </view>
            <view class="data-cell">
                <text class="dlbl">件 / 托</text>
                <input class="dinp" type="number" min="1" :value="perPallet" :disabled="disabled || palletLocked" :placeholder="palletLocked ? '采用订单要求' : ''" @input="onField('perPallet', $event)" />
            </view>
        </view>
    </view>
</template>

<script>
export default {
    name: 'BucketsCard',
    props: {
        buckets: { type: Object, default: () => ({}) },
        zeroCount: { type: [String, Number], default: '' },
        perCase: { type: [String, Number], default: '' },
        perPallet: { type: [String, Number], default: '' },
        palletLocked: Boolean, disabled: Boolean, legacyLayout: Boolean,
        bucketKeys: { type: Array, default: () => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] }
    },
    methods: {
        isBucketDisabled(idx) {
            if (idx === 0) return false
            const prev = Number(this.buckets[this.bucketKeys[idx - 1]]) || 0
            return prev <= 0
        },
        onBucket(key, e) {
            this.$emit('update:buckets', Object.assign({}, this.buckets, { [key]: e.detail.value }))
            this.$emit('change')
        },
        onField(key, e) {
            this.$emit('update:' + key, e.detail.value)
            this.$emit('change')
        }
    }
}
</script>

<style lang="scss" scoped>
.bucket-grid { display: flex; flex-wrap: wrap; margin: 0 -6rpx; }
.bucket-grid .bucket { flex: 0 0 calc(50% - 12rpx); margin: 0 6rpx 12rpx; }.bucket { box-sizing: border-box; display: flex; align-items: center; background: $canvas; padding: 12rpx 12rpx; border-radius: 17.6rpx; }
.bucket .binp { margin-left: 12rpx; }.blbl { flex-shrink: 0; font-size: 24rpx; color: $primary; font-weight: 600; }.binp { flex: 1; min-width: 0; height: 73.6rpx; font-size: 32rpx; text-align: right; background: transparent; }.binp[disabled] { color: $muted; }
.bucket-tail { margin-top: 16rpx; padding-top: 16rpx; border-top: 1px solid $line; }.data-grid { display: flex; flex-wrap: wrap; margin: 0 -6rpx; }
.data-grid .data-cell { flex: 0 0 calc(50% - 12rpx); margin: 0 6rpx 12rpx; }.data-cell { box-sizing: border-box; background: $canvas; border-radius: 16rpx; padding: 14rpx; min-height: 102.4rpx; display: flex; flex-direction: column; justify-content: center; }.dlbl { font-size: 24rpx; color: $muted; }.dinp { margin-top: 6rpx; font-size: 30rpx; background: transparent; height: 70.4rpx; }
// 安卓 App 恢复原有五列分桶及三列参数布局。
.legacy-layout {
    .bucket-grid { display: flex; flex-wrap: wrap; margin: 0 -5rpx; }
    .bucket-grid .bucket { flex: 0 0 calc(20% - 10rpx); margin: 0 5rpx 10rpx; }
    .bucket .binp { margin-left: 0; }
    .bucket { flex-direction: column; align-items: stretch; min-width: 0; padding: 0; border-radius: 0; background: transparent; }
    .blbl { margin-bottom: 4rpx; font-size: 22rpx; font-weight: normal; color: $muted; }
    .binp { flex: none; width: 100%; box-sizing: border-box; height: 60rpx; border: 1rpx solid $line; border-radius: 10rpx; font-size: 26rpx; text-align: center; background: $surface; }
    .binp[disabled] { background: $canvas; color: $muted; }
    .bucket-tail { margin-top: 12rpx; padding-top: 0; border-top: 0; }
    .data-grid { display: flex; flex-wrap: wrap; margin: 0 -6rpx; }
    .data-grid .data-cell { flex: 0 0 calc(33.333% - 12rpx); margin: 0 6rpx 12rpx; }
    .data-cell { min-width: 0; min-height: 88rpx; padding: 10rpx; border-radius: 12rpx; }
    .dlbl { font-size: 22rpx; }
    .dinp { margin-top: 4rpx; height: 40rpx; font-size: 26rpx; }
}
</style>
