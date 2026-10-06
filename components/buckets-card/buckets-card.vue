<template>
    <view>
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
        palletLocked: Boolean, disabled: Boolean,
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
.bucket-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }.bucket { display: flex; align-items: center; gap: .5rem; background: $canvas; padding: .5rem .6rem; border-radius: .55rem; }.blbl { flex-shrink: 0; font-size: .8rem; color: $primary; font-weight: 600; }.binp { flex: 1; min-width: 0; height: 2.3rem; font-size: 1rem; text-align: right; background: transparent; }.binp[disabled] { color: $muted; }
.bucket-tail { margin-top: .8rem; padding-top: .8rem; border-top: 1px solid $line; }.data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }.data-cell { background: $canvas; border-radius: .5rem; padding: .7rem; min-height: 3.2rem; display: flex; flex-direction: column; justify-content: center; }.dlbl { font-size: .75rem; color: $muted; }.dinp { margin-top: .3rem; font-size: .95rem; background: transparent; height: 2.2rem; }
</style>
