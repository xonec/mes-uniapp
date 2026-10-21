<template>
    <view>
        <!-- 追加项：标签 / 防伪（白格） -->
        <view class="addon-grid">
            <view class="addon-cell">
                <text class="addon-label">标签追加（张）</text>
                <input class="addon-input" type="number" min="0" :disabled="disabled" :value="labelExtra" @input="onInput('labelExtra', $event)" />
            </view>
            <view class="addon-cell">
                <text class="addon-label">防伪追加（张）</text>
                <input class="addon-input" type="number" min="0" :disabled="disabled" :value="securityExtra" @input="onInput('securityExtra', $event)" />
            </view>
        </view>
        <!-- 明细表：包材 / 领用 / 实用 / 损耗 / 退回（5 列；实用为自动值浅底） -->
        <view class="table">
            <view class="tr head">
                <text class="th name">包材</text>
                <text class="th num">领用</text>
                <text class="th num">实用</text>
                <text class="th num">损耗</text>
                <text class="th num">退回</text>
            </view>
            <view v-for="(material, index) in materials" :key="index" class="tr">
                <text class="td name">{{ material.name }}</text>
                <view class="td num"><input class="cell-input" type="number" min="0" :disabled="disabled" placeholder="0" v-model="material.issued" /></view>
                <view class="td num used"><text class="used-text">{{ material.used }}</text></view>
                <view class="td num"><input class="cell-input" type="number" min="0" :disabled="disabled" placeholder="0" v-model="material.loss" /></view>
                <view class="td num"><input class="cell-input" type="number" min="0" :disabled="disabled" placeholder="0" v-model="material.returned" /></view>
            </view>
        </view>
        <text class="note">实用数按生产数据自动计算；领用、损耗、退回填写任意两项。</text>
    </view>
</template>
<script>
export default {
    name: 'MesMaterialBody',
    props: {
        disabled: Boolean,
        labelExtra: { type: [String, Number], default: '' },
        securityExtra: { type: [String, Number], default: '' },
        materials: { type: Array, default: () => [] }
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
.addon-grid { display: flex; margin: 0 -4rpx 10rpx; }
.addon-cell { box-sizing: border-box; flex: 1 1 0; min-width: 0; margin: 0 4rpx; padding: 10rpx 12rpx; background: $surface; border: 1px solid $line; border-radius: 12rpx; }
.addon-label { display: block; font-size: 22rpx; color: $muted; line-height: 1.4; }
.addon-input { box-sizing: border-box; width: 100%; height: 56rpx; margin-top: 2rpx; font-size: 32rpx; font-weight: 600; background: transparent; }
.addon-input[disabled] { color: $muted; }
.table { overflow: hidden; }
.tr { display: flex; align-items: center; min-height: 88rpx; border-bottom: 1px solid $line; }
.tr:last-child { border-bottom: 0; }
.tr.head { min-height: 56rpx; }
.th, .td { box-sizing: border-box; font-size: 28rpx; }
.th { font-size: 22rpx; color: $muted; }
.name { flex: 1; min-width: 0; padding: 0 4rpx; font-weight: 600; }
.th.name { font-weight: 400; }
.num { flex: 0 0 88rpx; text-align: right; padding: 0 4rpx; }
.td.num { display: flex; align-items: center; justify-content: flex-end; align-self: stretch; }
.cell-input { box-sizing: border-box; width: 100%; height: 72rpx; font-size: 28rpx; text-align: right; background: transparent; }
.cell-input[disabled] { color: $muted; }
.used { background: $canvas; }
.used-text { font-size: 28rpx; font-weight: 600; color: var(--state-primary, #{$primary}); }
.note { display: block; margin-top: 10rpx; font-size: 22rpx; color: $muted; line-height: 1.5; }
</style>
