<template>
    <view class="page">
        <view class="card">
            <view class="card-title">包装指令单识别</view>
            <view class="tip">拍一张指令单照片，自动提取订单号、批号、产品、包装规格、计划产量、取样数。</view>
            <button class="btn primary" :disabled="recognizing" @tap="chooseImage">
                {{ recognizing ? '识别中（约 10~60 秒）…' : '拍照 / 选图识别' }}
            </button>
        </view>

        <view class="card" v-if="form">
            <view class="card-title">识别结果（可修改）</view>
            <view class="field" :class="{ warn: isUncertain('orderNo') }">
                <text class="lbl">订单号</text>
                <input class="inp" v-model="form.orderNo" type="text" placeholder="纯数字" />
            </view>
            <view class="field" :class="{ warn: isUncertain('batchNo') }">
                <text class="lbl">批号</text>
                <input class="inp" v-model="form.batchNo" type="text" placeholder="11位字母数字" />
            </view>
            <view class="field" :class="{ warn: isUncertain('productCode') }">
                <text class="lbl">产品编码</text>
                <input class="inp" v-model="form.productCode" type="text" placeholder="10位数字" />
            </view>
            <view class="field">
                <text class="lbl">产品名称</text>
                <input class="inp" v-model="form.productName" type="text" placeholder="产品名称" />
            </view>
            <view class="field">
                <text class="lbl">包装规格</text>
                <input class="inp" v-model="form.packSpec" type="text" placeholder="如 4瓶/箱" />
            </view>
            <view class="field" :class="{ warn: isUncertain('plannedQty') }">
                <text class="lbl">计划产量(件)</text>
                <input class="inp" v-model="form.plannedQty" type="number" placeholder="箱数" />
            </view>
            <view class="field">
                <text class="lbl">取样数</text>
                <input class="inp" v-model="form.sampleCount" type="text" placeholder="如 17" />
            </view>
            <view class="mat-block" v-if="matRows.length">
                <text class="mat-title">包装材料清单（{{ matRows.length }} 行，将写入物料档案）</text>
                <view class="mat-row" v-for="m in matRows" :key="m.seq">
                    <text class="mat-code">{{ m.materialCode }}</text>
                    <text class="mat-name">{{ m.materialName }}</text>
                    <text class="mat-unit">{{ m.unit }}</text>
                </view>
            </view>
            <text class="warn-tip" v-if="uncertainText">⚠ 黄色标出字段识别不确定，请核对后保存</text>
            <button class="btn primary" :disabled="saving" @tap="save">{{ saving ? '保存中…' : '确认入库' }}</button>
        </view>
    </view>
</template>

<script>
import { callCloud } from '@/utils/cloud-call.js'
import { upsertProductMaterials } from '@/utils/product-materials-db.js'
// #ifdef APP-PLUS
import { recognizeText as mlkitRecognizeText } from '@/uni_modules/hx-mlkit-ocr'
// #endif

export default {
    data() {
        return {
            recognizing: false,
            saving: false,
            form: null
        }
    },
    computed: {
        uncertainText() {
            const u = (this.form && this.form.uncertain) || []
            return u.filter(k => k !== 'productName' && k !== 'packSpec' && k !== 'sampleCount').join('、')
        },
        matRows() {
            return (this.form && Array.isArray(this.form.materials)) ? this.form.materials : []
        }
    },
    methods: {
        isUncertain(key) {
            return ((this.form && this.form.uncertain) || []).indexOf(key) >= 0
        },
        chooseImage() {
            uni.chooseImage({
                count: 1,
                sourceType: ['album', 'camera'],
                sizeType: ['compressed'],
                success: (res) => {
                    const p = res.tempFilePaths && res.tempFilePaths[0]
                    if (!p) return
                    // #ifdef APP-PLUS
                    // 安卓：本地 ML Kit 文本识别（离线免费），文字送云端小模型结构化
                    this.recognizing = true
                    let path2 = p
                    try { path2 = plus.io.convertLocalFileSystemURL(p) } catch (e) { /* ignore */ }
                    mlkitRecognizeText({
                        imagePath: path2,
                        success: (r) => {
                            const text = (r && r.text) || ''
                            if (!text.trim()) {
                                this.recognizing = false
                                uni.showModal({ title: '本地识别无结果', content: '图片中没识别到文字，请重拍或换一张', showCancel: false })
                                return
                            }
                            this.recognizeText(text)
                        },
                        fail: (err) => {
                            this.recognizing = false
                            uni.showModal({ title: '本地识别失败', content: (err && err.message) || '未知错误', showCancel: false })
                        }
                    })
                    // #endif
                    // #ifndef APP-PLUS
                    // 小程序：压缩后传图给云端视觉模型
                    uni.compressImage({
                        src: p,
                        quality: 60,
                        compressedWidth: 1280, // 长边 1280px：正文/小字兼顾，取样行等小字可读
                        success: (r) => this.readBase64(r.tempFilePath),
                        fail: () => this.readBase64(p)
                    })
                    // #endif
                }
            })
        },
        async recognizeText(text) {
            // 赠券高峰期模型可能排队超时，自动重试一次
            for (let attempt = 0; attempt < 2; attempt++) {
                if (attempt === 1) {
                    uni.showToast({ title: '排队超时，自动重试…', icon: 'none' })
                }
                try {
                    const r = await callCloud('doc-ocr', 'recognize', { text })
                    this.form = r || {}
                    this.recognizing = false
                    uni.showToast({ title: '识别完成，请核对', icon: 'none' })
                    return
                } catch (e) {
                    if (attempt === 0) continue
                    this.recognizing = false
                    uni.showModal({ title: '识别失败', content: (e.message || '请重试') + '（已自动重试一次）', showCancel: false })
                }
            }
        },
        readBase64(filePath) {
            // #ifdef APP-PLUS
            // App 端没有 uni.getFileSystemManager，用 plus.io 读文件为 base64（自带 data URL 前缀）
            plus.io.resolveLocalFileSystemURL(filePath, (entry) => {
                entry.file((file) => {
                    const reader = new plus.io.FileReader()
                    reader.onloadend = (e) => {
                        const result = e.target && e.target.result
                        if (result) this.recognize(result)
                        else uni.showToast({ title: '读取图片失败', icon: 'none' })
                    }
                    reader.onerror = () => uni.showToast({ title: '读取图片失败', icon: 'none' })
                    reader.readAsDataURL(file)
                }, () => uni.showToast({ title: '读取图片失败', icon: 'none' }))
            }, () => uni.showToast({ title: '读取图片失败', icon: 'none' }))
            // #endif
            // #ifndef APP-PLUS
            uni.getFileSystemManager().readFile({
                filePath,
                encoding: 'base64',
                success: (r) => {
                    const mime = String(filePath).toLowerCase().endsWith('.png') ? 'png' : 'jpg'
                    this.recognize(`data:image/${mime};base64,${r.data}`)
                },
                fail: () => uni.showToast({ title: '读取图片失败', icon: 'none' })
            })
            // #endif
        },
        async recognize(imageBase64) {
            this.recognizing = true
            try {
                const r = await callCloud('doc-ocr', 'recognize', { imageBase64 })
                this.form = r || {}
                uni.showToast({ title: '识别完成，请核对', icon: 'none' })
            } catch (e) {
                uni.showModal({ title: '识别失败', content: e.message || '请重试', showCancel: false })
            } finally {
                this.recognizing = false
            }
        },
        async save() {
            if (!this.form) return
            if (!String(this.form.orderNo || '').trim()) {
                uni.showToast({ title: '请填写订单号', icon: 'none' })
                return
            }
            this.saving = true
            try {
                await callCloud('doc-ocr', 'save', { record: this.form })
                // 物料清单同步写入物料档案（product_materials，source=photo）
                let matMsg = ''
                if (this.matRows.length && String(this.form.productCode || '').trim()) {
                    try {
                        // 物料编号只保留纯数字（-1 等后缀剔除），空编号行跳过
                        const materials = this.matRows
                            .map(m => ({ ...m, materialCode: String(m.materialCode || '').replace(/[^0-9]/g, '') }))
                            .filter(m => m.materialCode)
                        await upsertProductMaterials({
                            productCode: String(this.form.productCode).trim(),
                            productName: String(this.form.productName || '').trim(),
                            packSpec: String(this.form.packSpec || '').trim(),
                            materials,
                            sourceOrderNo: String(this.form.orderNo || '').trim(),
                            source: 'photo'
                        })
                        matMsg = '，物料已入档案'
                    } catch (e) {
                        matMsg = '，物料入档案失败：' + (e.message || '请稍后重试')
                    }
                }
                uni.showToast({ title: '已入库' + matMsg, icon: 'none', duration: 2500 })
                setTimeout(() => uni.navigateBack(), 900)
            } catch (e) {
                uni.showToast({ title: e.message || '保存失败', icon: 'none' })
            } finally {
                this.saving = false
            }
        }
    }
}
</script>

<style scoped>
.page { padding: 16rpx; min-height: 100vh; background: #F2F4F3; }
.card { background: #fff; border-radius: 16rpx; padding: 22rpx; margin-bottom: 16rpx; box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.03); }
.card-title { font-size: 28rpx; font-weight: 700; color: #1f2622; margin-bottom: 12rpx; }
.tip { font-size: 22rpx; color: #77827D; margin-bottom: 14rpx; line-height: 1.5; }
.btn { font-size: 28rpx; border-radius: 12rpx; height: 84rpx; line-height: 84rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; font-weight: 700; }
.btn[disabled] { opacity: 0.5; }
.field { display: flex; align-items: center; background: #F4F7F6; border-radius: 12rpx; padding: 0 18rpx; height: 84rpx; margin-bottom: 12rpx; }
.field.warn { background: #FBF3E2; border: 1rpx solid #EF9F27; }
.lbl { width: 150rpx; font-size: 26rpx; color: #77827D; flex-shrink: 0; }
.inp { flex: 1; height: 84rpx; font-size: 28rpx; background: transparent; }
.warn-tip { display: block; margin: 4rpx 0 12rpx; font-size: 22rpx; color: #BA7517; }
.mat-block { background: #F4F7F6; border-radius: 12rpx; padding: 16rpx; margin-bottom: 12rpx; }
.mat-title { display: block; font-size: 24rpx; color: #008577; font-weight: 700; margin-bottom: 8rpx; }
.mat-row { display: flex; align-items: center; gap: 10rpx; padding: 8rpx 0; border-bottom: 1rpx dashed #E3E8E5; }
.mat-row:last-child { border-bottom: none; }
.mat-code { font-size: 24rpx; color: #1f2622; flex-shrink: 0; font-family: monospace; }
.mat-name { flex: 1; min-width: 0; font-size: 24rpx; color: #4a554f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mat-unit { font-size: 22rpx; color: #77827D; flex-shrink: 0; }
</style>
