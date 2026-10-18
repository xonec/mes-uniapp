<template>
    <view class="scan-page">
        <!-- #ifdef APP-PLUS -->
        <view class="scan-strip">
            <view class="scan-frame-hint">
                <text class="scan-hint-text" v-if="lastBatch">上次录入：{{ lastBatch }}</text>
                <text class="scan-hint-text">将条码对准取景框，横跨扫描线</text>
                <text class="scan-hint-alert" v-if="showTip">没扫到？试试「相册识别」或返回手动输入</text>
            </view>
        </view>
        <view class="scan-toolbar">
            <button class="tool-btn" @tap="chooseAlbum">🖼 相册识别</button>
            <button class="tool-btn" @tap="toggleFlash">{{ flashOn ? '⚡ 关灯' : '⚡ 手电筒' }}</button>
        </view>
        <!-- #endif -->
        <!-- #ifndef APP-PLUS -->
        <view class="scan-fallback">
            <text>当前平台请在计算页使用扫码按钮</text>
        </view>
        <!-- #endif -->
    </view>
</template>

<script>
// #ifdef APP-PLUS
import { STORE_LAST_BATCH } from '@/utils/storage-keys.js'
// #endif

export default {
    data() {
        return {
            flashOn: false,
            done: false,
            barcode: null,
            lastBatch: '',
            showTip: false,
            tipTimer: null
        }
    },
    // #ifdef APP-PLUS
    onLoad() {
        try { this.lastBatch = uni.getStorageSync(STORE_LAST_BATCH) || '' } catch (e) { /* ignore */ }
    },
    onReady() {
        this.createScanner()
    },
    // #endif
    onUnload() {
        try { this.barcode && this.barcode.close() } catch (e) { /* ignore */ }
        if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
    },
    methods: {
        // #ifdef APP-PLUS
        /** 实时扫码与相册识别共用码制；内置 Barcode 模块，标准基座即可用，无需 UTS 插件。 */
        barcodeFilters() {
            return [
                plus.barcode.QR, plus.barcode.CODE128, plus.barcode.CODE39, plus.barcode.CODE93,
                plus.barcode.EAN13, plus.barcode.EAN8, plus.barcode.UPC_A, plus.barcode.UPC_E,
                plus.barcode.ITF, plus.barcode.CODABAR
            ]
        },
        createScanner() {
            const sys = uni.getSystemInfoSync()
            const statusBar = sys.statusBarHeight || 24
            const navBar = 44
            const toolbarH = 90
            const top = statusBar + navBar + 16
            const h = Math.max(sys.windowHeight - statusBar - navBar - toolbarH - 32, 200)
            const bc = plus.barcode.create('mes-scan', this.barcodeFilters(), {
                top: top + 'px',
                left: '0px',
                width: '100%',
                height: h + 'px',
                position: 'absolute',
                background: '#000000',
                frameColor: '#00E5A0',
                scanbarColor: '#00E5A0'
            })
            bc.onmarked = (type, result) => this.onMarked(type, result)
            bc.onerror = () => {}
            const pages = getCurrentPages()
            const page = pages[pages.length - 1]
            page.$getAppWebview().append(bc)
            bc.start()
            this.barcode = bc
            // 20 秒没扫到就给出下一步引导，避免用户干等
            this.tipTimer = setTimeout(() => { this.showTip = true }, 20000)
        },
        onMarked(type, result) {
            if (this.done) return
            this.done = true
            if (this.tipTimer) { clearTimeout(this.tipTimer); this.tipTimer = null }
            try { plus.device.beep(1) } catch (e) { /* ignore */ }
            try { plus.device.vibrate(200) } catch (e) { /* ignore */ }
            this.emitResult(result)
        },
        /** 相册识别：用内置 Barcode 模块的图片识别能力（标准基座可用），不再依赖 UTS 插件。 */
        chooseAlbum() {
            uni.chooseImage({
                count: 1,
                sourceType: ['album'],
                sizeType: ['original'],
                success: (res) => {
                    const raw = res.tempFilePaths && res.tempFilePaths[0]
                    if (!raw) return
                    // 内置 API 需要本地文件路径，uni.chooseImage 在 Android 上可能返回 file:// 前缀
                    const p = String(raw).replace(/^file:\/\//, '')
                    uni.showLoading({ title: '识别中…' })
                    try {
                        plus.barcode.scan(p, (type, code) => {
                            uni.hideLoading()
                            const text = String(code || '').trim()
                            if (!text) { this.albumNotFound(); return }
                            this.emitResult(text)
                        }, () => {
                            uni.hideLoading()
                            this.albumNotFound()
                        }, this.barcodeFilters(), true)
                    } catch (e) {
                        uni.hideLoading()
                        this.albumNotFound()
                    }
                }
            })
        },
        albumNotFound() {
            uni.showModal({ title: '未识别到条码', content: '请确保照片清晰、条码占画面比例大、无反光；也可以返回后直接对准条码实时扫描', showCancel: false })
        },
        toggleFlash() {
            this.flashOn = !this.flashOn
            try { this.barcode && this.barcode.setFlash(this.flashOn) } catch (e) { /* ignore */ }
        },
        emitResult(raw) {
            // 回传扫码结果：优先用页面事件通道；App 端 this.$scope 上不一定有该方法，需逐级容错
            try {
                let ch = null
                if (this.$scope && typeof this.$scope.getOpenerEventChannel === 'function') ch = this.$scope.getOpenerEventChannel()
                else if (typeof this.getOpenerEventChannel === 'function') ch = this.getOpenerEventChannel()
                if (ch && typeof ch.emit === 'function') ch.emit('scanResult', raw)
            } catch (e) {
                console.error('[scan] emit failed', e && (e.message || e))
            }
            uni.navigateBack()
        }
        // #endif
    }
}
</script>

<style scoped>
.scan-page {
    min-height: 100vh;
    background: #000;
    display: flex;
    flex-direction: column;
}
/* #ifdef APP-PLUS */
.scan-strip {
    flex: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}
.scan-frame-hint {
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.scan-hint-text { color: rgba(255, 255, 255, 0.75); font-size: 24rpx; line-height: 1.8; }
.scan-hint-alert { color: #FAC775; font-size: 24rpx; margin-top: 6rpx; }
.scan-toolbar {
    height: 90px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    background: #000;
}
.tool-btn {
    background: #1C1C1E;
    color: #fff;
    font-size: 26rpx;
    border-radius: 12rpx;
    padding: 0 30rpx;
    height: 72rpx;
    line-height: 72rpx;
}
/* #endif */
/* #ifndef APP-PLUS */
.scan-fallback {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
}
/* #endif */
</style>
