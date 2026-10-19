<template>
    <view class="material-editor">
        <view class="material-heading"><view><text class="material-title">包装材料清单</text><text class="material-count">{{ rows.length }} 项 · 点开逐项核对</text></view><button class="add-button" :disabled="disabled" @tap="add">＋ 添加</button></view>
        <view v-if="!rows.length" class="material-empty">还没有材料。可从照片识别，或手动添加物料。</view>
        <view v-for="(row, index) in rows" :key="index" class="material-item" :class="{ expanded: expandedIndex === index, incomplete: !row.materialCode || !row.unit }">
            <view class="material-summary" @tap="expandedIndex = expandedIndex === index ? -1 : index">
                <text class="material-seq">{{ index + 1 }}</text>
                <view class="material-overview"><text class="material-name">{{ row.materialName || '待填写物料名称' }}</text><text class="material-code">{{ row.materialCode || '缺少物料编号' }}<text v-if="row.unit"> · {{ row.unit }}</text></text><text v-if="expandedIndex !== index && row.spec" class="material-spec">{{ row.spec }}</text></view>
                <text class="material-toggle">{{ expandedIndex === index ? '收起' : '核对' }} {{ expandedIndex === index ? '⌃' : '›' }}</text>
            </view>
            <view v-if="expandedIndex === index" class="material-detail">
                <view class="material-fields">
                    <view v-for="field in fields" :key="field.key" class="material-field" :class="{ wide: field.key === 'spec' || field.key === 'materialName' }">
                        <text>{{ field.label }}</text>
                        <textarea v-if="field.key === 'spec' || field.key === 'materialName'" :value="row[field.key] || ''" :disabled="disabled" :maxlength="field.max" auto-height :placeholder="field.placeholder" @input="patch(index, field.key, $event.detail.value)" />
                        <input v-else :value="row[field.key] || ''" :disabled="disabled" :maxlength="field.max" :placeholder="field.placeholder" @input="patch(index, field.key, $event.detail.value)" />
                    </view>
                </view>
                <view class="material-source"><text>来源页：{{ sourceLabel(row.sourcePages) }}</text><button :disabled="disabled" @tap="sourceEditing = !sourceEditing">{{ sourceEditing ? '收起来源' : '修正来源' }}</button></view>
                <input v-if="sourceEditing" class="source-input" :value="Array.isArray(row.sourcePages) ? row.sourcePages.join(',') : row.sourcePages || ''" :disabled="disabled" maxlength="40" placeholder="如 1,2；未知留空" @input="patch(index, 'sourcePages', $event.detail.value)" />
                <button class="remove-button" :disabled="disabled" @tap="remove(index)">删除这项物料</button>
            </view>
        </view>
    </view>
</template>
<script>
import { MAX_MATERIAL_ROWS, patchMaterialRow, appendMaterialRow, removeMaterialRow, sourcePagesLabel } from '@/utils/shared/material-list.js'

export default {
    props: { value: { type: Array, default: () => [] }, disabled: Boolean },
    data() {
        return { expandedIndex: -1, sourceEditing: false, fields: [
            { key: 'materialCode', label: '物料编号 *', placeholder: '保留 -1 等原始后缀', max: 40 },
            { key: 'unit', label: '计量单位 *', placeholder: '千克 / 只 / 卷', max: 12 },
            { key: 'materialName', label: '物料名称', placeholder: '物料名称', max: 120 },
            { key: 'spec', label: '规格型号', placeholder: '按单据原文填写', max: 2000 },
            { key: 'materialVersion', label: '物料版本号', placeholder: '未识别留空', max: 20 }
        ] }
    },
    computed: { rows() { return this.value || [] } },
    watch: { expandedIndex() { this.sourceEditing = false } },
    methods: {
        sourceLabel(pages) { return sourcePagesLabel(pages) },
        patch(index, key, value) { this.$emit('input', patchMaterialRow(this.rows, index, key, value)) },
        add() {
            if (this.disabled) return
            const next = appendMaterialRow(this.rows)
            if (!next) return uni.showToast({ title: '最多 ' + MAX_MATERIAL_ROWS + ' 行物料', icon: 'none' })
            this.expandedIndex = this.rows.length
            this.$emit('input', next)
        },
        async remove(index) {
            if (this.disabled) return
            const yes = await new Promise(resolve => uni.showModal({ title: '删除物料', content: '确认删除第 ' + (index + 1) + ' 项物料？', success: result => resolve(result.confirm), fail: () => resolve(false) }))
            if (!yes || this.disabled) return
            if (this.expandedIndex === index) this.expandedIndex = -1
            else if (this.expandedIndex > index) this.expandedIndex--
            this.$emit('input', removeMaterialRow(this.rows, index))
        }
    }
}
</script>
<style lang="scss" scoped>
.material-heading { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; margin-bottom: 20rpx; }
.material-title { display: block; font-size: 32rpx; font-weight: 700; }.material-count { display: block; font-size: 24rpx; margin-top: 8rpx; color: $muted; }
.add-button { flex-shrink: 0; margin: 0; padding: 0 16rpx; font-size: 25.6rpx; line-height: 80rpx; border-radius: 16rpx; background: $primary-soft; color: $primary; }.add-button::after { border: 0; }
.material-item { margin-top: 12rpx; border: 1px solid $line; border-radius: 19.2rpx; overflow: hidden; }.material-item.expanded { border-color: $primary; }.material-item.incomplete { border-color: $warning; }
.material-summary { display: flex; align-items: flex-start; gap: 14rpx; padding: 18rpx 14rpx; }.material-seq { flex-shrink: 0; color: $primary; background: $primary-soft; border-radius: 9.6rpx; width: 51.2rpx; line-height: 51.2rpx; text-align: center; font-size: 24rpx; }
.material-overview { min-width: 0; flex: 1; }.material-name { display: block; font-size: 28.8rpx; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }.material-code { display: block; font-size: 25rpx; color: $muted; margin-top: 6rpx; }.material-spec { display: block; font-size: 24rpx; line-height: 1.5; color: $muted; margin-top: 8rpx; max-height: 3em; overflow: hidden; }
.material-toggle { flex-shrink: 0; font-size: 24rpx; line-height: 54.4rpx; color: $primary; }.material-detail { border-top: 1px solid $line; padding: 16rpx; }
.material-fields { display: flex; flex-wrap: wrap; gap: 16rpx; }.material-field { flex: 1 1 224rpx; min-width: 0; }.material-field.wide { flex-basis: 100%; }
.material-field text { display: block; color: $muted; font-size: 25.6rpx; margin-bottom: 8rpx; }
.material-field input, .material-field textarea, .source-input { width: 100%; box-sizing: border-box; padding: 14rpx; min-height: 86.4rpx; background: $canvas; font-size: 28.8rpx; border-radius: 12.8rpx; }
.material-empty { color: $muted; padding: 32rpx 12rpx; line-height: 1.6; font-size: 27.2rpx; background: $canvas; border-radius: 16rpx; text-align: center; }
.material-source { margin-top: 16rpx; display: flex; align-items: center; justify-content: space-between; color: $muted; font-size: 24rpx; }.material-source button { margin: 0; font-size: 24rpx; padding: 6rpx 0 6rpx 12rpx; line-height: 1.6; background: $surface; color: $primary; }.material-source button::after, .remove-button::after { border: 0; }
.remove-button { margin: 20rpx 0 0; padding: 0; line-height: 80rpx; background: $surface; color: $danger; border-top: 1px solid $line; border-radius: 0; font-size: 25.6rpx; }
</style>
