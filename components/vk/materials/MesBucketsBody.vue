<template>
    <view>
        <!-- A–J：5 列 × 2 行（A–E / F–J），格宽约 128rpx；整格可点（热区=整格 ≥112rpx）聚焦对应输入 -->
        <view class="bucket-grid">
            <view class="bucket" v-for="(key, idx) in bucketKeys" :key="key" @tap="focusField(key, idx, $event)">
                <text class="bucket-label">{{ key }}桶</text>
                <input class="bucket-input" type="number" min="0" :disabled="disabled || isBucketDisabled(idx)" :focus="focusKey === key" placeholder="0" :value="buckets[key]" @input="onBucket(key, $event)" @blur="onBlur(key)" />
            </view>
        </view>
        <!-- 零箱 / 瓶-件 / 件-托：留在分桶卡底部；整格可点聚焦 -->
        <view class="tail-grid">
            <view class="tail-cell" @tap="focusField('zeroCount', -1, $event)">
                <text class="tail-label">零箱（瓶）</text>
                <input class="tail-input" type="number" min="0" :disabled="disabled" :focus="focusKey === 'zeroCount'" placeholder="0" :value="zeroCount" @input="onField('zeroCount', $event)" @blur="onBlur('zeroCount')" />
            </view>
            <view class="tail-cell" @tap="focusField('perCase', -1, $event)">
                <text class="tail-label">瓶 / 件</text>
                <input class="tail-input" type="number" min="1" :disabled="disabled" :focus="focusKey === 'perCase'" :placeholder="perCase ? '' : '请选择'" :value="perCase" @input="onField('perCase', $event)" @blur="onBlur('perCase')" />
            </view>
            <view class="tail-cell" @tap="focusField('perPallet', -1, $event)">
                <text class="tail-label">件 / 托</text>
                <input class="tail-input" type="number" min="1" :disabled="disabled || palletLocked" :focus="focusKey === 'perPallet'" :placeholder="palletLocked ? '采用订单要求' : '请选择'" :value="perPallet" @input="onField('perPallet', $event)" @blur="onBlur('perPallet')" />
            </view>
        </view>
    </view>
</template>
<script>
export default {
    name: 'MesBucketsBody',
    props: {
        buckets: { type: Object, default: () => ({}) },
        bucketKeys: { type: Array, default: () => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] },
        zeroCount: { type: [String, Number], default: '' },
        perCase: { type: [String, Number], default: '' },
        perPallet: { type: [String, Number], default: '' },
        palletLocked: Boolean,
        disabled: Boolean
    },
    data() {
        // 整格可点：当前应由 :focus 驱动聚焦的目标 key（纯 UI 态，不落 storage）
        return { focusKey: '' }
    },
    methods: {
        /** 整格点击 → 聚焦对应输入框：视觉不变，仅把热区从 input(56rpx) 扩到整格(≥112rpx)；禁用格不抢焦点。 */
        focusField(key, idx, e) {
            if (this.disabled) return
            if (idx >= 0 && this.isBucketDisabled(idx)) return
            if (key === 'perPallet' && this.palletLocked) return
            this.focusKey = key
            // #ifdef H5
            // H5 直接 focus 内部原生 input，保证点在格内任意位置（含 label/边缘）都能聚焦
            const input = e && e.currentTarget && e.currentTarget.querySelector ? e.currentTarget.querySelector('input') : null
            if (input && typeof input.focus === 'function') input.focus()
            // #endif
        },
        /** 失焦后清空驱动值，允许再次整格点击聚焦。 */
        onBlur(key) {
            if (this.focusKey === key) this.focusKey = ''
        },
        /** 前置桶为 0 时禁填后序桶（沿用现有录入顺序约束）。 */
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
.bucket-grid { display: flex; flex-wrap: wrap; margin: 0 -4rpx; }
.bucket { box-sizing: border-box; flex: 0 0 calc(20% - 8rpx); margin: 0 4rpx 8rpx; min-height: 112rpx; padding: 8rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; background: $surface; border: 1px solid $line; border-radius: 12rpx; }
.bucket-label { font-size: 22rpx; color: $muted; line-height: 1.3; }
.bucket-input { box-sizing: border-box; width: 100%; height: 56rpx; margin-top: 2rpx; font-size: 32rpx; font-weight: 600; text-align: center; background: transparent; }
.bucket-input[disabled] { color: $muted; }
.tail-grid { display: flex; margin: 6rpx -4rpx 0; }
.tail-cell { box-sizing: border-box; flex: 1 1 0; min-width: 0; margin: 0 4rpx; min-height: 96rpx; padding: 10rpx 8rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; background: $surface; border: 1px solid $line; border-radius: 12rpx; }
.tail-label { font-size: 22rpx; color: $muted; line-height: 1.3; }
.tail-input { box-sizing: border-box; width: 100%; height: 56rpx; margin-top: 2rpx; font-size: 32rpx; font-weight: 600; text-align: center; background: transparent; }
.tail-input[disabled] { color: $muted; }
</style>
