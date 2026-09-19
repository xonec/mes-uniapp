<template>
    <view class="data-grid">
        <view class="data-cell"><text class="dlbl">单箱净重（kg）</text><input class="dinp" type="digit" :value="boxNetWeight" @input="onInput('boxNetWeight', $event)" /></view>
        <view class="data-cell"><text class="dlbl">单瓶重量（kg）</text><input class="dinp" type="digit" :value="bottleWeight" @input="onInput('bottleWeight', $event)" /></view>
        <view class="data-cell"><text class="dlbl">重量范围</text><text class="dval">{{ weightRange }}</text></view>
        <view class="data-cell"><text class="dlbl">单瓶最低（kg）</text><input class="dinp" type="digit" :value="bottleWeightMin" @input="onInput('bottleWeightMin', $event)" /></view>
        <view class="data-cell"><text class="dlbl">单箱净重最低（kg）</text><input class="dinp" type="digit" :value="boxNetWeightMin" @input="onInput('boxNetWeightMin', $event)" /></view>
    </view>
</template>

<script>
export default {
    name: 'WeightCard',
    props: {
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

<style scoped>
.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; }
.data-cell { background: #F7F9F8; border-radius: 12rpx; padding: 10rpx; min-height: 88rpx; display: flex; flex-direction: column; justify-content: center; }
.dlbl { font-size: 20rpx; color: #77827D; }
.dinp { margin-top: 4rpx; font-size: 26rpx; background: transparent; height: 40rpx; }
.dval { margin-top: 4rpx; font-size: 28rpx; font-weight: 700; color: #008577; }
</style>
