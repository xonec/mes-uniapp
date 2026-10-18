<template>
    <view class="login-page">
        <view class="login-box">
            <view class="logo">
                <text class="logo-mark">MES</text>
                <text class="logo-t">生产助手</text>
                <text class="logo-s">生产计算 · 指令单录入 · 产品档案</text>
            </view>
            <view class="field">
                <text class="lbl">账号</text>
                <input class="inp" :disabled="loading" v-model="username" type="text" placeholder="请输入账号" confirm-type="next" />
            </view>
            <view class="field">
                <text class="lbl">密码</text>
                <input class="inp" :disabled="loading" v-model="password" :password="!showPwd" placeholder="请输入密码" confirm-type="done" @confirm="doLogin" />
                <text class="eye" @tap="showPwd = !showPwd">{{ showPwd ? '隐藏' : '显示' }}</text>
            </view>
            <view class="row">
                <view class="rm" @tap="remember = !remember">
                    <view class="cb" :class="{ on: remember }"><text v-if="remember" class="tick">✓</text></view>
                    <text class="rm-t">记住账号密码</text>
                </view>
                <text class="clear" @tap="clearSaved">清空</text>
            </view>
            <button class="login-btn" :disabled="loading" @tap="doLogin">{{ loading ? '登录中…' : '登 录' }}</button>
            <text class="err" v-if="errMsg">{{ errMsg }}</text>
        </view>
    </view>
</template>

<script>
import { login, isLoggedIn } from '@/utils/auth.js'

// 本地记住账号密码的 storage key（密码仅 base64 混淆，非加密，仅内部工具使用）
const SAVED_KEY = 'mes_login_saved'
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// base64 编解码（unicode 安全，兼容小程序无 btoa/atob 环境）
function b64e(str) {
    const bytes = []
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i)
        if (c < 0x80) bytes.push(c)
        else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
        else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
        else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
        out += B64[b0 >> 2]
        out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)]
        out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)]
        out += b2 === undefined ? '=' : B64[b2 & 63]
    }
    return out
}
function b64d(str) {
    const rev = {}
    for (let i = 0; i < B64.length; i++) rev[B64[i]] = i
    const bytes = []
    for (let i = 0; i < str.length; i += 4) {
        const c0 = rev[str[i]], c1 = rev[str[i + 1]], c2 = str[i + 2] === '=' ? 0 : rev[str[i + 2]], c3 = str[i + 3] === '=' ? 0 : rev[str[i + 3]]
        bytes.push((c0 << 2) | (c1 >> 4))
        if (str[i + 2] !== '=') bytes.push(((c1 & 15) << 4) | (c2 >> 2))
        if (str[i + 3] !== '=') bytes.push(((c2 & 3) << 6) | c3)
    }
    let out = ''
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i++]
        if (b < 0x80) out += String.fromCharCode(b)
        else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f))
        else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
        else out += String.fromCharCode(((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
    }
    return out
}

export default {
    data() {
        return {
            username: '',
            password: '',
            loading: false,
            errMsg: '',
            remember: false,
            showPwd: false
        }
    },
    onLoad() {
        // 已登录直接进主页（若带了分享批号则一起带过去）
        if (isLoggedIn()) {
            this.enterAfterLogin()
            return
        }
        this.loadSaved()
    },
    methods: {
        // 登录后进入主页，若有暂存的分享批号则带上，让主页加载该批云端数据
        enterAfterLogin() {
            const shareBatch = uni.getStorageSync('mes-share-batch') || ''
            uni.removeStorageSync('mes-share-batch')
            const url = shareBatch ? '/pages/materials/materials?batchNo=' + shareBatch : '/pages/operations/workbench'
            uni.reLaunch({ url })
        },
        // 回填上次记住的账号 / 密码
        loadSaved() {
            try {
                const raw = uni.getStorageSync(SAVED_KEY)
                if (!raw) return
                const s = typeof raw === 'string' ? JSON.parse(raw) : raw
                this.remember = !!s.remember
                if (s.remember && s.username) this.username = s.username
                if (s.remember && s.password) this.password = b64d(s.password)
            } catch (e) { /* 忽略损坏的本地数据 */ }
        },
        // 登录成功后按开关保存
        saveCredentials() {
            uni.setStorageSync(SAVED_KEY, JSON.stringify({
                remember: this.remember,
                username: this.remember ? this.username : '',
                password: this.remember ? b64e(this.password) : ''
            }))
        },
        // 清空输入与已保存的账号密码
        clearSaved() {
            this.username = ''
            this.password = ''
            this.remember = false
            uni.removeStorageSync(SAVED_KEY)
        },
        async doLogin() {
            const u = (this.username || '').trim()
            const p = this.password || ''
            if (!u || !p) { this.errMsg = '请输入账号和密码'; return }
            this.loading = true
            this.errMsg = ''
            try {
                await login(u, p)
                this.saveCredentials()
                this.enterAfterLogin()
            } catch (e) {
                this.errMsg = e.message || '登录失败'
            } finally {
                this.loading = false
            }
        }
    }
}
</script>

<style lang="scss" scoped>
.login-page { box-sizing: border-box; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: $canvas; padding: calc(var(--status-bar-height) + 64rpx) 32rpx calc(64rpx + env(safe-area-inset-bottom)); }.login-box { box-sizing: border-box; width: 100%; max-width: 864rpx; background: $surface; border-radius: 32rpx; padding: 64rpx 44.8rpx; border-top: 9.6rpx solid $primary; }
.logo { margin-bottom: 54.4rpx; }.logo-mark { display: inline-block; color: $primary; background: $primary-soft; padding: 12.8rpx 20.8rpx; border-radius: 16rpx; font-size: 24rpx; font-weight: 700; letter-spacing: 2.6rpx; margin-bottom: 28.8rpx; }.logo-t { display: block; font-size: 51.2rpx; font-weight: 700; color: $ink; }.logo-s { display: block; margin-top: 16rpx; font-size: 25rpx; line-height: 1.6; color: $muted; }
.field { display: flex; align-items: center; background: $canvas; border-radius: 19.2rpx; padding: 0 25.6rpx; min-height: 102.4rpx; margin-bottom: 25.6rpx; }.lbl { width: 80rpx; font-size: 27.2rpx; color: $muted; flex-shrink: 0; }.inp { flex: 1; min-width: 0; height: 102.4rpx; font-size: 30.4rpx; background: transparent; }.eye { font-size: 24rpx; color: $primary; padding: 19.2rpx 0 19.2rpx 16rpx; flex-shrink: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin: 6.4rpx 0 19.2rpx; }.rm { display: flex; align-items: center; padding: 16rpx 0; }.cb { width: 35.2rpx; height: 35.2rpx; border-radius: 8rpx; border: 1px solid $line; display: flex; align-items: center; justify-content: center; margin-right: 16rpx; box-sizing: border-box; }.cb.on { background: $primary; border-color: $primary; }.tick { font-size: 25.6rpx; color: $surface; line-height: 1; }.rm-t { font-size: 25.6rpx; color: $muted; }.clear { font-size: 25.6rpx; color: $muted; padding: 16rpx 0; }
.login-btn { line-height: 96rpx; border-radius: 19.2rpx; background: $primary; color: $surface; font-size: 32rpx; font-weight: 700; margin-top: 19.2rpx; }.login-btn::after { border: 0; }.login-btn[disabled] { opacity: .6; }.err { display: block; margin-top: 28.8rpx; font-size: 27.2rpx; color: $danger; line-height: 1.6; }
</style>
