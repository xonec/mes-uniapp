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
.material-addons { display: flex; gap: 12rpx; margin-bottom: 16rpx; }.data-cell { flex: 1; min-width: 0; padding: 14rpx; background: $canvas; border-radius: 16rpx; }.label { display: block; font-size: 24rpx; color: $muted; margin-bottom: 6rpx; }.number-input { width: 100%; box-sizing: border-box; min-width: 0; height: 76.8rpx; padding: 0 10rpx; font-size: 30.4rpx; background: $canvas; border-radius: 12.8rpx; }.usage-item { padding: 16rpx; border: 1px solid $line; border-radius: 19.2rpx; margin-bottom: 12rpx; }.usage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; margin-bottom: 16rpx; font-size: 28.8rpx; font-weight: 600; }.used { color: $primary; background: $primary-soft; font-size: 25.6rpx; border-radius: 9.6rpx; padding: 6rpx 10rpx; }.usage-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12rpx; }.usage-note { display: block; color: $muted; font-size: 24rpx; margin-top: 16rpx; line-height: 1.6; }
</style>
