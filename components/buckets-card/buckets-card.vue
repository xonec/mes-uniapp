<template>
    <view>
        <view class="bucket-grid">
            <view class="bucket" v-for="(key, idx2) in bucketKeys" :key="key">
                <text class="blbl">{{ key }}桶</text>
                <input class="binp" type="number" min="0" :disabled="isBucketDisabled(idx2)"
                    :placeholder="'0'" :value="buckets[key]" @input="onBucket(key, $event)" />
            </view>
        </view>
        <view class="data-grid bucket-tail">
            <view class="data-cell">
                <text class="dlbl">零箱（瓶）</text>
                <input class="dinp" type="number" min="0" :value="zeroCount" @input="onField('zeroCount', $event)" />
            </view>
            <view class="data-cell">
                <text class="dlbl">瓶 / 件</text>
                <input class="dinp" type="number" min="1" :value="perCase" @input="onField('perCase', $event)" />
            </view>
            <view class="data-cell">
                <text class="dlbl">件 / 托</text>
                <input class="dinp" type="number" min="1" :value="perPallet" @input="onField('perPallet', $event)" />
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

<style scoped>
.bucket-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10rpx; }
.bucket-tail { margin-top: 12rpx; }
.bucket { display: flex; flex-direction: column; }
.blbl { font-size: 20rpx; color: #77827D; margin-bottom: 4rpx; }
.binp { height: 60rpx; border: 1rpx solid #E3E8E5; border-radius: 10rpx; font-size: 26rpx; text-align: center; background: #fff; }
.binp[disabled] { background: #F2F4F3; color: #bbb; }
.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; }
.data-cell { background: #F7F9F8; border-radius: 12rpx; padding: 10rpx; min-height: 88rpx; display: flex; flex-direction: column; justify-content: center; }
.dlbl { font-size: 20rpx; color: #77827D; }
.dinp { margin-top: 4rpx; font-size: 26rpx; background: transparent; height: 40rpx; }
</style>
