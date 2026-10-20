<template>
    <view class="fw-page">
        <view class="fw-header"><text class="fw-subtitle">按产品编码查找规格和包装材料。</text></view>
        <button class="fw-button primary import-button" @tap="importProduct">＋ 从照片录入产品</button>
        <view class="archive-tabs"><button :class="{ active: tab === 'materials' }" @tap="switchTab('materials')">产品物料</button><button :class="{ active: tab === 'bom' }" @tap="switchTab('bom')">计算模板</button></view>
        <view class="fw-search"><input v-model="kw" placeholder="搜索已加载的产品编码 / 名称" confirm-type="search" /><text v-if="kw" class="fw-search-clear" @tap="kw = ''">清除</text></view>
        <view class="list-caption"><text>{{ tab === 'materials' ? '包装材料清单' : '包材计算参数模板' }} · 已载入 {{ list.length }} 项</text><text @tap="load">{{ loading ? '加载中…' : '刷新' }}</text></view>
        <view v-if="tab === 'bom'" class="fw-notice">计算模板用于计算参数，与产品包装材料清单分别维护。</view>
        <view v-if="error" class="fw-notice error">{{ error }}<button class="fw-button secondary" :disabled="loading" @tap="load">重新加载</button></view>
        <view v-if="loading && !list.length" class="fw-card fw-empty"><text class="fw-empty-title">正在载入档案</text><text class="fw-note">请稍候…</text></view>
        <view v-else-if="!error && !filtered.length" class="fw-card fw-empty"><text class="fw-empty-title">{{ kw ? '当前列表未找到产品' : '还没有档案' }}</text><text class="fw-note">{{ kw ? '尝试完整产品编码，或刷新列表。' : '录入包装指令单后，产品资料会保存在这里。' }}</text><button v-if="!kw && tab === 'materials'" class="fw-button" @tap="importProduct">录入第一份产品档案</button></view>
        <view v-for="r in filtered" :key="r.productCode" class="archive-item fw-card" @tap="openProduct(r)">
            <view class="archive-heading"><text class="product-code">{{ r.productCode }}</text><text class="fw-badge">{{ r.materialCount == null ? '—' : r.materialCount }} 项材料</text></view>
            <text class="product-name">{{ r.productName || '未填写产品名称' }}</text><text class="product-spec">{{ r.packSpec || '未填写包装规格' }}</text>
            <view class="archive-bottom"><text>产品资料{{ r.version ? ' · V' + r.version : '' }}</text><text v-if="tab === 'materials'">查看 / 核对 ›</text></view>
        </view>
    </view>
</template>
<script>
import { listProductMaterials } from '@/utils/product-materials-db.js'
import { listBoms } from '@/utils/bom-db.js'
import { getUser } from '@/utils/auth.js'
import { openPage } from '@/utils/vk-migration.js'
export default {
    data() { return { tab: 'materials', list: [], kw: '', loading: false, error: '', requestNo: 0 } },
    computed: { filtered() { const keyword = this.kw.trim().toLowerCase(); return keyword ? this.list.filter(row => [row.productCode, row.productName].some(value => String(value || '').toLowerCase().includes(keyword))) : this.list } },
    onShow() { if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }; this.load() },
    methods: {
        importProduct() { openPage('order-sheet', { purpose: 'bom' }) },
        openProduct(record) { if (this.tab === 'materials') openPage('order-sheet', { purpose: 'bom', productCode: record.productCode }) },
        switchTab(tab) { if (this.tab !== tab) { this.tab = tab; this.list = []; this.kw = ''; this.load() } },
        async load() {
            const request = ++this.requestNo, tab = this.tab
            this.loading = true; this.error = ''
            try { const list = tab === 'materials' ? await listProductMaterials() : await listBoms(); if (request === this.requestNo) this.list = list }
            catch (error) { if (request === this.requestNo) this.error = error.message || '档案暂时无法加载，请重试' }
            finally { if (request === this.requestNo) this.loading = false }
        }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.import-button { width: 100%; margin-bottom: 20rpx; }.archive-tabs { display: flex;  margin-bottom: 20rpx; background: $line; padding: 6rpx; border-radius: 20.8rpx; }.archive-tabs button { margin: 0; flex: 1; line-height: 76.8rpx; font-size: 28.8rpx; padding: 0 12rpx; background: transparent; color: $muted; border-radius: 14.4rpx; }.archive-tabs button::after { border: 0; }.archive-tabs button.active { background: $surface; color: $primary; font-weight: 600; }
.list-caption { display: flex; align-items: center; justify-content: space-between;  font-size: 24rpx; color: $muted; margin-bottom: 16rpx; }.list-caption text:last-child { color: $primary; padding: 8rpx 0; }
.archive-heading { display: flex; align-items: center; justify-content: space-between;  }.product-code { font-size: 25.6rpx; color: $primary; letter-spacing: 1.3rpx; }.product-name { display: block; font-size: 32rpx; font-weight: 600; line-height: 1.5; margin-top: 12rpx; }.product-spec { display: block; font-size: 27.2rpx; color: $muted; line-height: 1.6; margin-top: 8rpx; overflow-wrap: anywhere; }.archive-bottom { display: flex; justify-content: space-between;  border-top: 1px solid $line; margin-top: 16rpx; padding-top: 14rpx; font-size: 24rpx; color: $muted; }.archive-bottom text:last-child { color: $primary; }.fw-notice .fw-button { margin-top: 12rpx; }

.archive-tabs button + button { margin-left: 6rpx; }
.list-caption text + text { margin-left: 12rpx; }
.archive-heading .fw-badge { margin-left: 12rpx; }
.archive-bottom text + text { margin-left: 12rpx; }

</style>
