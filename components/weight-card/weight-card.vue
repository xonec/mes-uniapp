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
.data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }.data-cell { background: $canvas; border-radius: .5rem; padding: .75rem; min-height: 3.5rem; display: flex; flex-direction: column; justify-content: center; }.dlbl { font-size: .75rem; color: $muted; }.dinp { margin-top: .3rem; font-size: .95rem; background: transparent; height: 2.3rem; }.dval { margin-top: .5rem; font-size: 1rem; font-weight: 700; color: $primary; }.weight-result { grid-column: span 2; order: 1; background: $primary-soft; }
</style>
