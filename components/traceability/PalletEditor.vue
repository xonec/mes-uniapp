<template>
  <view class="pallet-editor">
    <view class="pallet-heading"><text class="pallet-title">上托要求</text><text class="pallet-state" :class="{ confirmed: value.status === 'confirmed' }">{{ value.status === 'confirmed' ? '已确认' : Number(value.casesPerPallet) > 0 ? '待确认' : '待补充' }}</text></view>
    <view class="pallet-summary" @tap="expanded = !expanded"><view class="pallet-summary-main"><text class="pallet-number">{{ Number(value.casesPerPallet) > 0 ? value.casesPerPallet + ' 箱 / 托' : '尚未填写每托箱数' }}</text><text class="pallet-description">{{ summary }}</text></view><view class="pallet-edit">{{ expanded ? '收起' : '补充 / 编辑' }}<uni-icons :type="expanded ? 'up' : 'right'" size="11" color="#008577"></uni-icons></view></view>
    <view v-if="expanded" class="pallet-detail">
      <view class="pallet-grid">
        <view v-for="field in fields" :key="field.key" class="pallet-field" :class="{ wide: field.wide }">
          <text class="pallet-label">{{ field.label }}</text>
          <textarea v-if="field.wide" class="pallet-input" :value="value[field.key] || ''" :disabled="disabled" maxlength="2000" auto-height :placeholder="field.placeholder || '未填写'" @input="patch(field.key, $event.detail.value)" />
          <input v-else class="pallet-input" :value="value[field.key] == null ? '' : value[field.key]" :type="field.numeric ? 'number' : 'text'" :disabled="disabled" :maxlength="field.max || 6" :placeholder="field.placeholder || '未填写'" @input="patch(field.key, $event.detail.value)" />
        </view>
        <view class="pallet-field wide"><text class="pallet-label">要求来源 *</text><picker :range="sourceOptions" range-key="text" :value="sourceIndex" :disabled="disabled" @change="patch('sourceType', sourceOptions[Number($event.detail.value)].value)"><view class="pallet-picker">{{ sourceOptions[sourceIndex].text }} ›</view></picker></view>
        <view class="pallet-field wide"><text class="pallet-label">配置状态</text><picker :range="statusOptions" range-key="text" :value="value.status === 'confirmed' ? 1 : 0" :disabled="disabled" @change="changeStatus"><view class="pallet-picker">{{ value.status === 'confirmed' ? '已确认，可以计算托数' : '待补充，暂不计算托数' }} ›</view></picker></view>
      </view>
      <view class="pallet-note">每托箱数可直接填写，或由箱 / 层 × 层数计算。确认时需要来源和依据，托盘尺寸请按实际要求填写。</view>
    </view>
    <view v-if="value.status !== 'confirmed'" class="pending-note">可先保存订单，上托确认后再计算托数。</view>
  </view>
</template>
<script>
import { patchPalletField, palletConfirmBlocker } from '@/utils/shared/pallet.js'

export default {
  props: { value: { type: Object, default: () => ({}) }, disabled: Boolean },
  data() { return { expanded: false, autoCalculated: false, fields: [{ key: 'casesPerLayer', label: '箱 / 层', numeric: true }, { key: 'layers', label: '层数', numeric: true }, { key: 'casesPerPallet', label: '箱 / 托 *', numeric: true }, { key: 'dimensions', label: '托盘尺寸', placeholder: '如1200×1000mm', max: 120 }, { key: 'placement', label: '摆放说明', wide: true }, { key: 'sourceNote', label: '依据说明 *', placeholder: '客户要求或现场标准的名称、日期等', wide: true }], sourceOptions: [{ value: '', text: '请选择来源' }, { value: 'customer', text: '客户要求' }, { value: 'site', text: '现场标准' }, { value: 'document', text: '单据明确记载' }], statusOptions: [{ value: 'pending', text: '待补充' }, { value: 'confirmed', text: '已确认' }] }; },
  computed: {
    sourceIndex() { return Math.max(0, this.sourceOptions.findIndex(option => option.value === this.value.sourceType)); },
    summary() { if (Number(this.value.casesPerLayer) > 0 && Number(this.value.layers) > 0) return this.value.casesPerLayer + ' 箱 / 层 × ' + this.value.layers + ' 层'; return this.value.sourceNote || '按客户或本次订单确认'; }
  },
  watch: { value(next) { if (next !== this.lastEmitted) this.autoCalculated = false; } },
  methods: {
    patch(key, value) {
      if (this.disabled) return
      const result = patchPalletField(this.value, key, value, this.autoCalculated)
      this.autoCalculated = result.autoCalculated
      this.lastEmitted = result.value; this.$emit('input', result.value)
    },
    changeStatus(event) {
      const status = this.statusOptions[Number(event.detail.value)].value
      const blocker = status === 'confirmed' ? palletConfirmBlocker(this.value) : ''
      if (blocker) return uni.showToast({ title: blocker, icon: 'none' })
      this.patch('status', status)
    }
  }
};
</script>
<style lang="scss" scoped>
/* 微信小程序组件 wxss 不允许标签选择器：这里统一用 class，避免样式被整段丢弃 */
/* 旧版微信 WebView 不支持 flex gap：统一用 margin 保持视觉不变 */
.pallet-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16rpx; }.pallet-title { font-weight: 700; font-size: 32rpx; }.pallet-state { margin-left: 16rpx; }
.pallet-state { color: $warning; background: mix($warning, $surface, 10%); padding: 6rpx 12rpx; border-radius: 12.8rpx; font-size: 23rpx; }.pallet-state.confirmed { color: $primary; background: $primary-soft; }
.pallet-summary { display: flex; align-items: center; justify-content: space-between; padding: 16rpx; border-radius: 17.6rpx; background: $canvas; }.pallet-summary-main { flex: 1; min-width: 0; }.pallet-number { display: block; font-size: 32rpx; font-weight: 600; }.pallet-description { display: block; margin-top: 8rpx; font-size: 25.6rpx; color: $muted; line-height: 1.5; overflow-wrap: anywhere; }.pallet-edit { flex-shrink: 0; display: flex; align-items: center; margin-left: 14rpx; font-size: 24rpx; color: $primary; }
.pallet-detail { margin-top: 20rpx; }.pallet-note, .pending-note { color: $muted; font-size: 25.6rpx; margin-top: 16rpx; line-height: 1.6; }.pending-note { color: $warning; }
.pallet-grid { display: flex; flex-wrap: wrap; margin: 0 -8rpx -16rpx; }.pallet-field { flex: 1 1 224rpx; min-width: 0; margin: 0 8rpx 16rpx; }.pallet-field.wide { flex-basis: 100%; }
.pallet-label { display: block; margin-bottom: 8rpx; color: $muted; font-size: 25.6rpx; }
.pallet-input, .pallet-picker { width: 100%; box-sizing: border-box; min-height: 86.4rpx; padding: 14rpx; background: $canvas; border-radius: 16rpx; font-size: 28.8rpx; }
</style>
