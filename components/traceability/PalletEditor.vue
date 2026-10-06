<template>
  <view class="pallet-editor">
    <view class="pallet-heading"><text class="pallet-title">上托要求</text><text class="pallet-state" :class="{ confirmed: value.status === 'confirmed' }">{{ value.status === 'confirmed' ? '已确认' : Number(value.casesPerPallet) > 0 ? '待确认' : '待补充' }}</text></view>
    <view class="pallet-summary" @tap="expanded = !expanded"><view><text class="pallet-number">{{ Number(value.casesPerPallet) > 0 ? value.casesPerPallet + ' 箱 / 托' : '尚未填写每托箱数' }}</text><text class="pallet-description">{{ summary }}</text></view><text class="pallet-edit">{{ expanded ? '收起 ⌃' : '补充 / 编辑 ›' }}</text></view>
    <view v-if="expanded" class="pallet-detail">
      <view class="pallet-grid">
        <view v-for="field in fields" :key="field.key" class="pallet-field" :class="{ wide: field.wide }">
          <text>{{ field.label }}</text>
          <textarea v-if="field.wide" :value="value[field.key] || ''" :disabled="disabled" maxlength="2000" auto-height :placeholder="field.placeholder || '未填写'" @input="patch(field.key, $event.detail.value)" />
          <input v-else :value="value[field.key] == null ? '' : value[field.key]" :type="field.numeric ? 'number' : 'text'" :disabled="disabled" :maxlength="field.max || 6" :placeholder="field.placeholder || '未填写'" @input="patch(field.key, $event.detail.value)" />
        </view>
        <view class="pallet-field wide"><text>要求来源 *</text><picker :range="sourceOptions" range-key="text" :value="sourceIndex" :disabled="disabled" @change="patch('sourceType', sourceOptions[Number($event.detail.value)].value)"><view class="pallet-picker">{{ sourceOptions[sourceIndex].text }} ›</view></picker></view>
        <view class="pallet-field wide"><text>配置状态</text><picker :range="statusOptions" range-key="text" :value="value.status === 'confirmed' ? 1 : 0" :disabled="disabled" @change="changeStatus"><view class="pallet-picker">{{ value.status === 'confirmed' ? '已确认，可以计算托数' : '待补充，暂不计算托数' }} ›</view></picker></view>
      </view>
      <view class="pallet-note">每托箱数可直接填写，或由箱 / 层 × 层数计算。确认时需要来源和依据，托盘尺寸请按实际要求填写。</view>
    </view>
    <view v-if="value.status !== 'confirmed'" class="pending-note">可先保存订单，上托确认后再计算托数。</view>
  </view>
</template>
<script>
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
      const next = { ...this.value, [key]: value }
      if (key === 'casesPerPallet') this.autoCalculated = false
      if (key === 'casesPerLayer' || key === 'layers') {
        if (Number(next.casesPerLayer) > 0 && Number(next.layers) > 0) { next.casesPerPallet = Number(next.casesPerLayer) * Number(next.layers); this.autoCalculated = true; }
        else if (this.autoCalculated) { next.casesPerPallet = ''; next.status = 'pending'; }
      }
      this.lastEmitted = next; this.$emit('input', next)
    },
    changeStatus(event) {
      const status = this.statusOptions[Number(event.detail.value)].value
      if (status === 'confirmed' && (!Number.isInteger(Number(this.value.casesPerPallet)) || Number(this.value.casesPerPallet) <= 0 || !this.value.sourceType || !String(this.value.sourceNote || '').trim())) return uni.showToast({ title: '请补齐每托箱数、来源和依据', icon: 'none' })
      this.patch('status', status)
    }
  }
};
</script>
<style lang="scss" scoped>
.pallet-heading { display: flex; justify-content: space-between; align-items: center; gap: .8rem; margin-bottom: .8rem; }.pallet-title { font-weight: 700; font-size: 1rem; }
.pallet-state { color: $warning; background: mix($warning, $surface, 10%); padding: .25rem .6rem; border-radius: .4rem; font-size: .72rem; }.pallet-state.confirmed { color: $primary; background: $primary-soft; }
.pallet-summary { display: flex; align-items: center; justify-content: space-between; gap: .7rem; padding: .8rem; border-radius: .55rem; background: $canvas; }.pallet-summary > view { flex: 1; min-width: 0; }.pallet-number { display: block; font-size: 1rem; font-weight: 600; }.pallet-description { display: block; margin-top: .35rem; font-size: .8rem; color: $muted; line-height: 1.5; overflow-wrap: anywhere; }.pallet-edit { flex-shrink: 0; font-size: .75rem; color: $primary; }
.pallet-detail { margin-top: 1rem; }.pallet-note, .pending-note { color: $muted; font-size: .8rem; margin-top: .8rem; line-height: 1.6; }.pending-note { color: $warning; }
.pallet-grid { display: flex; flex-wrap: wrap; gap: .8rem; }.pallet-field { flex: 1 1 7rem; min-width: 0; }.pallet-field.wide { flex-basis: 100%; }
.pallet-field text { display: block; margin-bottom: .4rem; color: $muted; font-size: .8rem; }
.pallet-field input, .pallet-field textarea, .pallet-picker { width: 100%; box-sizing: border-box; min-height: 2.7rem; padding: .7rem; background: $canvas; border-radius: .5rem; font-size: .9rem; }
</style>
