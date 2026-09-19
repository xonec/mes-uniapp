<template>
    <view>
        <view class="material-addons">
            <view class="data-cell"><text class="dlbl">标签追加（张）</text><input class="dinp" type="number" min="0" placeholder="0" :value="labelExtra" @input="onAddon('labelExtra', $event)" /></view>
            <view class="data-cell"><text class="dlbl">防伪追加（张）</text><input class="dinp" type="number" min="0" placeholder="0" :value="securityExtra" @input="onAddon('securityExtra', $event)" /></view>
        </view>
        <view class="material-table">
            <view class="material-row head"><text>包材</text><text>领用</text><text>实用</text><text>损耗</text><text>退回</text></view>
            <view class="material-row" v-for="(m, i) in materials" :key="i">
                <text class="mname">{{ m.name }}</text>
                <input class="minp" type="number" min="0" placeholder="0" v-model="m.issued" />
                <input class="minp used" :value="m.used" disabled />
                <input class="minp" type="number" min="0" placeholder="0" v-model="m.loss" />
                <input class="minp" type="number" min="0" placeholder="0" v-model="m.returned" />
            </view>
        </view>
        <text class="hint pad">实用数按生产数据自动计算；领用、损耗、退回可选填，随保存记录。</text>
    </view>
</template>

<script>
export default {
    name: 'MaterialCard',
    props: {
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

<style scoped>
.material-addons { display: flex; gap: 12rpx; margin-bottom: 10rpx; }
.material-table { border: 1rpx solid #E3E8E5; border-radius: 12rpx; overflow: hidden; }
.material-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr; align-items: center; padding: 8rpx 10rpx; border-bottom: 1rpx solid #F0F3F1; font-size: 22rpx; }
.material-row:last-child { border-bottom: none; }
.material-row.head { background: #F4F7F6; color: #77827D; font-size: 20rpx; }
.mname { font-weight: 600; }
.minp { height: 48rpx; border: 1rpx solid #E3E8E5; border-radius: 8rpx; font-size: 22rpx; text-align: center; background: #fff; margin: 0 2rpx; }
.minp.used { background: #F2F4F3; color: #555; }
.pad { display: block; margin-top: 10rpx; }
.data-cell { background: #F7F9F8; border-radius: 12rpx; padding: 10rpx; min-height: 88rpx; display: flex; flex-direction: column; justify-content: center; flex: 1; }
.dlbl { font-size: 20rpx; color: #77827D; }
.dinp { margin-top: 4rpx; font-size: 26rpx; background: transparent; height: 40rpx; }
.hint { font-size: 20rpx; color: #77827D; }
</style>
