<template>
    <view class="fw-page">
        <view class="fw-header"><text class="fw-eyebrow">产品资料</text><text class="fw-title">产品档案</text><text class="fw-subtitle">按产品编码查找规格和包装材料。</text></view>
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
export default {
    data() { return { tab: 'materials', list: [], kw: '', loading: false, error: '', requestNo: 0 } },
    computed: { filtered() { const keyword = this.kw.trim().toLowerCase(); return keyword ? this.list.filter(row => [row.productCode, row.productName].some(value => String(value || '').toLowerCase().includes(keyword))) : this.list } },
    onShow() { if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }; this.load() },
    methods: {
        importProduct() { uni.navigateTo({ url: '/pages/order-sheet/order-sheet?purpose=bom' }) },
        openProduct(record) { if (this.tab === 'materials') uni.navigateTo({ url: '/pages/order-sheet/order-sheet?purpose=bom&productCode=' + encodeURIComponent(record.productCode) }) },
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
.import-button { width: 100%; margin-bottom: 1rem; }.archive-tabs { display: flex; gap: .3rem; margin-bottom: 1rem; background: $line; padding: .25rem; border-radius: .65rem; }.archive-tabs button { margin: 0; flex: 1; line-height: 2.4rem; font-size: .9rem; padding: 0 .5rem; background: transparent; color: $muted; border-radius: .45rem; }.archive-tabs button::after { border: 0; }.archive-tabs button.active { background: $surface; color: $primary; font-weight: 600; }
.list-caption { display: flex; align-items: center; justify-content: space-between; gap: .6rem; font-size: .75rem; color: $muted; margin-bottom: .8rem; }.list-caption text:last-child { color: $primary; padding: .4rem 0; }
.archive-heading { display: flex; align-items: center; justify-content: space-between; gap: .6rem; }.product-code { font-size: .8rem; color: $primary; letter-spacing: .04rem; }.product-name { display: block; font-size: 1rem; font-weight: 600; line-height: 1.5; margin-top: .6rem; }.product-spec { display: block; font-size: .85rem; color: $muted; line-height: 1.6; margin-top: .4rem; overflow-wrap: anywhere; }.archive-bottom { display: flex; justify-content: space-between; gap: .5rem; border-top: 1px solid $line; margin-top: .8rem; padding-top: .7rem; font-size: .75rem; color: $muted; }.archive-bottom text:last-child { color: $primary; }.fw-notice .fw-button { margin-top: .6rem; }
</style>
