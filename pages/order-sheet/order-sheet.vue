<template>
    <view class="page">
        <view class="card">
            <view class="card-title">包装指令单识别</view>
            <view class="tip">拍一张指令单照片，自动提取订单号、批号、产品、包装规格、计划产量、取样数。</view>
            <button class="btn primary" :disabled="recognizing" @tap="chooseImage">
                {{ recognizing ? '识别中（约 5~10 秒）…' : '拍照 / 选图识别' }}
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
            <text class="warn-tip" v-if="uncertainText">⚠ 黄色标出字段识别不确定，请核对后保存</text>
            <button class="btn primary" :disabled="saving" @tap="save">{{ saving ? '保存中…' : '确认入库' }}</button>
        </view>
    </view>
</template>

<script>
import { callCloud } from '@/utils/cloud-call.js'

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
                    uni.compressImage({
                        src: p,
                        quality: 60,
                        compressedWidth: 1024, // 长边缩到 1024px：识别精度够用，速度/ token 再降一半
                        success: (r) => this.readBase64(r.tempFilePath),
                        fail: () => this.readBase64(p)
                    })
                }
            })
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
                uni.showToast({ title: '已入库', icon: 'success' })
                setTimeout(() => uni.navigateBack(), 800)
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
</style>
