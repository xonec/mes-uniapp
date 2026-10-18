<template>
    <view class="fw-page op-page"><view class="fw-header"><text class="fw-subtitle">输入同一单位的实测值，以逗号、空格或换行分隔。</text></view><view class="fw-card"><view class="fw-field"><text class="fw-label">实测数值（最多 200 项）</text><textarea v-model="input" class="fw-textarea" maxlength="6000" placeholder="例如 907.2, 909.5, 908.1" /></view><button class="fw-button primary" @tap="calculate">计算</button></view><view v-if="error" class="fw-notice error">{{ error }}</view><view v-if="result" class="fw-card"><view class="op-row"><text>样本数 n</text><text class="op-name">{{ result.n }}</text></view><view class="op-row"><text>平均值</text><text class="op-name">{{ result.mean }}</text></view><view class="op-row"><text>样本标准差 s</text><text class="op-name">{{ result.sd }}</text></view><text class="op-meta">样本标准差使用 n−1 为分母。结果是计算值，未登记为批次检验结论。</text></view></view>
</template>
<script>
export default { data() { return { input: '', result: null, error: '' } }, watch: { input() { this.result = null; this.error = '' } }, methods: {
    calculate() {
        this.result = null; this.error = ''
        const tokens = this.input.trim().split(/[,，;；\s]+/).filter(Boolean)
        if (tokens.length < 2 || tokens.length > 200 || tokens.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))) { this.error = '请输入 2～200 个有效数值，不要混入单位或文字'; return }
        let count = 0, mean = 0, m2 = 0
        tokens.forEach(value => { count++; const number = Number(value), delta = number - mean; mean += delta / count; m2 += delta * (number - mean) })
        const sd = Math.sqrt(Math.max(0, m2 / (count - 1)))
        if (!Number.isFinite(mean) || !Number.isFinite(sd)) { this.error = '数值超出计算范围'; return }
        this.result = { n: count, mean: Number(mean.toFixed(6)), sd: Number(sd.toFixed(6)) }
    }
} }
</script>
<style lang="scss" scoped>@import '@/styles/operations.scss';</style>
