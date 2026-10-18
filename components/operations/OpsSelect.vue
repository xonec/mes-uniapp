<template><view class="fw-field"><text class="fw-label">{{ label }}</text><picker :range="options" range-key="name" :value="selectedIndex" :disabled="disabled" @change="change"><view class="fw-input">{{ selectedName || '请选择' }}</view></picker></view></template>
<script>
export default {
    props: { value: { type: String, default: '' }, label: { type: String, default: '' }, items: { type: Array, default: () => [] }, disabled: Boolean, optional: Boolean },
    computed: {
        options() { const items = this.items.filter(item => item.enabled !== false); return [{ _id: '', name: this.optional ? '不选择' : '请选择' }, ...items] },
        selectedIndex() { return Math.max(0, this.options.findIndex(item => item._id === this.value)) },
        selectedName() { const item = this.options.find(item => item._id === this.value); return item && item.name }
    },
    methods: { change(event) { this.$emit('input', (this.options[Number(event.detail.value)] || {})._id || '') } }
}
</script>
<style lang="scss" scoped>@import '@/styles/field-work.scss';</style>
