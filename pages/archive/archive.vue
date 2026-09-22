<template>
    <view class="page">
        <view class="tabs">
            <view class="tab" :class="{ active: tab === 'materials' }" @tap="switchTab('materials')">物料档案</view>
            <view class="tab" :class="{ active: tab === 'bom' }" @tap="switchTab('bom')">产品 BOM</view>
        </view>
        <scroll-view scroll-y class="body">
            <view v-for="(r, i) in list" :key="i" class="item">
                <view class="i-main">
                    <text class="i-name">{{ r.productName || r.productCode }}</text>
                    <text class="i-sub">{{ r.productCode }}</text>
                </view>
                <text class="i-spec">{{ r.packSpec || '' }}</text>
                <text class="i-count">{{ r.materialCount }} 项</text>
            </view>
            <view v-if="loading" class="empty">加载中…</view>
            <view v-else-if="list.length === 0" class="empty">暂无档案（请先在云控制台灌库）</view>
        </scroll-view>
    </view>
</template>

<script>
// 档案页：产品物料档案（product_materials）+ 产品 BOM（product_bom）只读列表
import { listProductMaterials } from '@/utils/product-materials-db.js'
import { listBoms } from '@/utils/bom-db.js'
import { getUser } from '@/utils/auth.js'

export default {
    data() {
        return {
            tab: 'materials',
            list: [],
            loading: false
        }
    },
    onShow() {
        if (!getUser()) {
            uni.reLaunch({ url: '/pages/login/login' })
            return
        }
        this.load()
    },
    methods: {
        switchTab(t) {
            if (this.tab === t) return
            this.tab = t
            this.load()
        },
        async load() {
            this.loading = true
            this.list = []
            try {
                this.list = this.tab === 'materials' ? await listProductMaterials() : await listBoms()
            } catch (e) {
                console.warn('[archive] 加载档案失败：', e && e.message)
                this.list = []
            } finally {
                this.loading = false
            }
        }
    }
}
</script>

<style scoped>
.page { min-height: 100vh; background: #F2F4F3; }
.tabs { display: flex; background: #fff; padding: 8rpx 16rpx; }
.tab { flex: 1; text-align: center; font-size: 28rpx; color: #77827D; padding: 20rpx 0; border-bottom: 4rpx solid transparent; }
.tab.active { color: #008577; font-weight: 700; border-bottom-color: #008577; }
.body { padding: 16rpx; }
.item { background: #fff; border-radius: 12rpx; padding: 22rpx 18rpx; margin-bottom: 12rpx; display: flex; align-items: center; gap: 16rpx; }
.i-main { flex: 1; min-width: 0; }
.i-name { font-size: 28rpx; font-weight: 600; color: #1f2622; display: block; }
.i-sub { font-size: 22rpx; color: #77827D; }
.i-spec { font-size: 22rpx; color: #77827D; max-width: 220rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.i-count { font-size: 24rpx; color: #008577; background: #E6F4F1; padding: 4rpx 16rpx; border-radius: 999rpx; flex-shrink: 0; }
.empty { text-align: center; color: #bbb; padding: 80rpx; font-size: 24rpx; }
</style>
