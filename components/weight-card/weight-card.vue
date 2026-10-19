<template>
    <view class="data-grid">
        <view class="data-cell"><text class="dlbl">单箱净重（kg）</text><input class="dinp" :disabled="disabled" type="digit" :value="boxNetWeight" @input="onInput('boxNetWeight', $event)" /></view>
        <view class="data-cell"><text class="dlbl">单瓶重量（kg）</text><input class="dinp" :disabled="disabled" type="digit" :value="bottleWeight" @input="onInput('bottleWeight', $event)" /></view>
        <view class="data-cell weight-result"><text class="dlbl">重量范围</text><text class="dval">{{ weightRange }}</text></view>
        <view class="data-cell"><text class="dlbl">单瓶最低（kg）</text><input class="dinp" :disabled="disabled" type="digit" :value="bottleWeightMin" @input="onInput('bottleWeightMin', $event)" /></view>
        <view class="data-cell"><text class="dlbl">单箱净重最低（kg）</text><input class="dinp" :disabled="disabled" type="digit" :value="boxNetWeightMin" @input="onInput('boxNetWeightMin', $event)" /></view>
    </view>
</template>

<script>
export default {
    name: 'WeightCard',
    props: {
        disabled: Boolean,
        boxNetWeight: { type: [String, Number], default: '' },
        bottleWeight: { type: [String, Number], default: '' },
        weightRange: { type: String, default: '—' },
        bottleWeightMin: { type: [String, Number], default: '' },
        boxNetWeightMin: { type: [String, Number], default: '' }
    },
    methods: {
        onInput(key, e) {
            this.$emit('update:' + key, e.detail.value)
            this.$emit('change')
        }
    }
}
</script>

<style lang="scss" scoped>
.data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12rpx; }.data-cell { background: $canvas; border-radius: 16rpx; padding: 16rpx; min-height: 112rpx; display: flex; flex-direction: column; justify-content: center; }.dlbl { font-size: 24rpx; color: $muted; }.dinp { margin-top: 6rpx; font-size: 30.4rpx; background: transparent; height: 73.6rpx; }.dval { margin-top: 12rpx; font-size: 32rpx; font-weight: 700; color: $primary; }.weight-result { grid-column: span 2; order: 1; background: $primary-soft; }
</style>
