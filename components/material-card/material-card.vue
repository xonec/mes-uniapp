<template>
    <view>
        <view class="material-addons"><view class="data-cell"><text class="label">标签追加（张）</text><input class="number-input" :disabled="disabled" type="number" placeholder="0" :value="labelExtra" @input="onAddon('labelExtra', $event)" /></view><view class="data-cell"><text class="label">防伪追加（张）</text><input class="number-input" :disabled="disabled" type="number" placeholder="0" :value="securityExtra" @input="onAddon('securityExtra', $event)" /></view></view>
        <view v-for="(material, index) in materials" :key="index" class="usage-item"><view class="usage-heading"><text>{{ material.name }}</text><text class="used">实用 {{ material.used }}</text></view><view class="usage-fields"><view><text class="label">领用</text><input class="number-input" :disabled="disabled" type="number" placeholder="0" v-model="material.issued" /></view><view><text class="label">损耗</text><input class="number-input" :disabled="disabled" type="number" placeholder="0" v-model="material.loss" /></view><view><text class="label">退回</text><input class="number-input" :disabled="disabled" type="number" placeholder="0" v-model="material.returned" /></view></view></view>
        <text class="usage-note">实用量按生产数据计算；领用、损耗、退回随生产记录保存。</text>
    </view>
</template>
<script>
export default {
    name: 'MaterialCard',
    props: {
        disabled: Boolean,
        labelExtra: { type: [String, Number], default: '' },
        securityExtra: { type: [String, Number], default: '' },
        materials: { type: Array, default: () => [] }
    },
    methods: {
        onAddon(key, e) {
            this.$emit('update:' + key, e.detail.value)
            this.$emit('change')
        }
    }
}
</script>
<style lang="scss" scoped>
.material-addons { display: flex; gap: .6rem; margin-bottom: .8rem; }.data-cell { flex: 1; min-width: 0; padding: .7rem; background: $canvas; border-radius: .5rem; }.label { display: block; font-size: .75rem; color: $muted; margin-bottom: .3rem; }.number-input { width: 100%; box-sizing: border-box; min-width: 0; height: 2.4rem; padding: 0 .45rem; font-size: .95rem; background: $canvas; border-radius: .4rem; }.usage-item { padding: .8rem; border: 1px solid $line; border-radius: .6rem; margin-bottom: .6rem; }.usage-heading { display: flex; align-items: center; justify-content: space-between; gap: .6rem; margin-bottom: .75rem; font-size: .9rem; font-weight: 600; }.used { color: $primary; background: $primary-soft; font-size: .8rem; border-radius: .3rem; padding: .25rem .45rem; }.usage-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }.usage-note { display: block; color: $muted; font-size: .75rem; margin-top: .75rem; line-height: 1.6; }
</style>
