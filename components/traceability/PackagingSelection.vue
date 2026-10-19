<template>
  <view class="selection">
    <view class="selection-heading"><text class="selection-title">客户与包装方案</text><text class="selection-badge">{{ loading ? '载入中…' : value.planVersionId ? 'V' + value.planVersion : '按本单录入' }}</text></view>
    <view v-if="error" class="selection-error">{{ error }}<button :disabled="disabled || loading" @tap="load">重试</button></view>
    <view class="selection-field"><text>客户 *</text><picker :range="customerOptions" range-key="text" :value="customerIndex" :disabled="disabled || loading" @change="chooseCustomer"><view class="selection-picker"><text>{{ customerOptions[customerIndex].text }}</text><text>›</text></view></picker></view>
    <view class="selection-field"><text>包装方案</text><picker :range="planOptions" range-key="text" :value="planIndex" :disabled="disabled || loading || !value.customerId" @change="choosePlan"><view class="selection-picker" :class="{ muted: !value.customerId }"><text>{{ value.customerId ? planOptions[planIndex].text : '先选择客户' }}</text><text>›</text></view></picker></view>
    <view class="selection-note">{{ value.planVersionId ? '已采用该版本的材料和上托要求，请按本次指令单复核。' : '没有可用方案时，可按本次指令单填写材料。' }}</view>
  </view>
</template>
<script>
export default {
  props: { value: { type: Object, default: () => ({}) }, recordKey: { type: Number, default: 0 }, call: { type: Function, required: true }, disabled: Boolean },
  data() { return { customers: [], plans: [], loadingCustomers: false, loadingPlans: false, loadingPlan: false, error: '', requestNo: 0, selectionRequest: 0, alive: true }; },
  computed: {
    selectionContext() { return { epoch: this.recordKey, productCode: this.value.productCode, customerId: this.value.customerId }; },
    loading() { return this.loadingCustomers || this.loadingPlans || this.loadingPlan; },
    customerOptions() { const options = [{ value: '', text: '请选择客户' }, ...this.customers.map(row => ({ value: row._id, text: row.name }))]; if (this.value.customerId && !options.some(row => row.value === this.value.customerId)) options.push({ value: this.value.customerId, text: this.value.customerName || '原客户' }); return options; },
    customerIndex() { return Math.max(0, this.customerOptions.findIndex(row => row.value === this.value.customerId)); },
    planOptions() { const options = [{ value: '', text: '按本次指令单录入' }, ...this.plans.map(row => ({ value: row.planVersionId, text: row.planName + ' · V' + row.version }))]; if (this.value.planVersionId && !options.some(row => row.value === this.value.planVersionId)) options.push({ value: this.value.planVersionId, text: (this.value.planName || '原方案') + ' · V' + (this.value.planVersion || '—') }); return options; },
    planIndex() { return Math.max(0, this.planOptions.findIndex(row => row.value === this.value.planVersionId)); }
  },
  watch: {
    loading(value) { this.$emit('loading', value); },
    selectionContext(context, previous) {
      this.selectionRequest++; this.loadingPlan = false
      if (previous && context.epoch === previous.epoch && previous.productCode && context.productCode !== previous.productCode && this.value.planVersionId) this.$emit('input', this.withoutPlan(true))
      this.loadPlans()
    }
  },
  mounted() { this.load(); },
  beforeDestroy() { this.alive = false; this.requestNo++; this.selectionRequest++; this.$emit('loading', false); },
  methods: {
    withoutPlan(clearDetails) { return { ...this.value, planVersionId: '', planId: '', planName: '', planVersion: null, ...(clearDetails ? { materials: [], pallet: {} } : {}) }; },
    async confirmReplace() { return new Promise(resolve => uni.showModal({ title: '更换包装方案', content: '此操作会替换当前材料清单和上托要求，请在变更后重新核对。', confirmText: '确认更换', success: result => resolve(result.confirm), fail: () => resolve(false) })); },
    async load() {
      if (this.loading) return
      this.loadingCustomers = true; this.error = ''
      try { const rows = await this.call('production-orders', 'listCustomers'); if (!this.alive) return; this.customers = rows; await this.loadPlans(); }
      catch (error) { if (this.alive) this.error = error.message || '客户加载失败'; }
      finally { this.loadingCustomers = false; }
    },
    async loadPlans() {
      const request = ++this.requestNo
      if (!/^\d{10}$/.test(String(this.value.productCode || '')) || !this.value.customerId) { this.plans = []; this.loadingPlans = false; return; }
      this.loadingPlans = true; this.error = ''
      try { const rows = await this.call('production-orders', 'listPlans', { productCode: this.value.productCode, customerId: this.value.customerId }); if (this.alive && request === this.requestNo) this.plans = rows; }
      catch (error) { if (this.alive && request === this.requestNo) { this.plans = []; this.error = error.message || '方案加载失败'; } }
      finally { if (request === this.requestNo) this.loadingPlans = false; }
    },
    async chooseCustomer(event) {
      if (this.disabled || this.loading) return
      const option = this.customerOptions[Number(event.detail.value)]
      if (!option || option.value === this.value.customerId) return
      const original = this.value
      if (this.value.planVersionId && !await this.confirmReplace()) return
      if (!this.alive || this.disabled || original !== this.value) return
      this.$emit('input', { ...this.withoutPlan(!!this.value.planVersionId), customerId: option.value, customerName: option.value ? option.text : '', pallet: {} })
    },
    async choosePlan(event) {
      if (this.disabled || this.loading) return
      const option = this.planOptions[Number(event.detail.value)]
      if (!option || option.value === this.value.planVersionId) return
      const original = this.value, epoch = this.recordKey
      if ((this.value.materials || []).length && !await this.confirmReplace()) return
      if (!this.alive || this.disabled || original !== this.value || epoch !== this.recordKey) return
      if (!option.value) { this.$emit('input', this.withoutPlan(true)); return; }
      const request = ++this.selectionRequest
      this.loadingPlan = true; this.error = ''
      try {
        const plan = await this.call('production-orders', 'getPlanVersion', { planVersionId: option.value })
        if (!this.alive || request !== this.selectionRequest || original !== this.value || epoch !== this.recordKey) return
        this.$emit('input', { ...this.value, planVersionId: option.value, planId: plan.planId, planName: plan.planName, planVersion: plan.version, materials: (plan.materials || []).map(row => ({ ...row, sourcePages: [] })), pallet: { ...plan.pallet } })
      } catch (error) { if (this.alive && request === this.selectionRequest) this.error = error.message || '方案载入失败'; }
      finally { if (request === this.selectionRequest) this.loadingPlan = false; }
    }
  }
};
</script>
<style lang="scss" scoped>
.selection-heading { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; margin-bottom: 20rpx; }.selection-title { font-weight: 700; font-size: 32rpx; }.selection-badge { font-size: 23rpx; color: $primary; background: $primary-soft; padding: 6rpx 12rpx; border-radius: 11.2rpx; }
.selection-field { margin-bottom: 18rpx; }.selection-field > text { display: block; color: $muted; font-size: 25.6rpx; margin-bottom: 8rpx; }
.selection-picker { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; background: $canvas; padding: 16rpx; border-radius: 16rpx; font-size: 28.8rpx; min-height: 44.8rpx; }.selection-picker text:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }.selection-picker text:last-child { color: $primary; }.selection-picker.muted { color: $muted; }
.selection-note { color: $muted; line-height: 1.6; margin-top: 12rpx; font-size: 25.6rpx; }.selection-error { color: $danger; margin-bottom: 16rpx; font-size: 25.6rpx; line-height: 1.6; }.selection-error button { display: inline; margin: 0; padding: 4rpx 12rpx; line-height: 1.6; font-size: 25.6rpx; background: $surface; color: $primary; }.selection-error button::after { border: 0; }
</style>
