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
            const url = '/pages/materials/materials' + (shareBatch ? '?batchNo=' + shareBatch : '')
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
.login-page { box-sizing: border-box; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: $canvas; padding: 2rem 1rem calc(2rem + env(safe-area-inset-bottom)); }.login-box { box-sizing: border-box; width: 100%; max-width: 27rem; background: $surface; border-radius: 1rem; padding: 2rem 1.4rem; border-top: .3rem solid $primary; }
.logo { margin-bottom: 1.7rem; }.logo-mark { display: inline-block; color: $primary; background: $primary-soft; padding: .4rem .65rem; border-radius: .5rem; font-size: .75rem; font-weight: 700; letter-spacing: .08rem; margin-bottom: .9rem; }.logo-t { display: block; font-size: 1.6rem; font-weight: 700; color: $ink; }.logo-s { display: block; margin-top: .5rem; font-size: .78rem; line-height: 1.6; color: $muted; }
.field { display: flex; align-items: center; background: $canvas; border-radius: .6rem; padding: 0 .8rem; min-height: 3.2rem; margin-bottom: .8rem; }.lbl { width: 2.5rem; font-size: .85rem; color: $muted; flex-shrink: 0; }.inp { flex: 1; min-width: 0; height: 3.2rem; font-size: .95rem; background: transparent; }.eye { font-size: .75rem; color: $primary; padding: .6rem 0 .6rem .5rem; flex-shrink: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin: .2rem 0 .6rem; }.rm { display: flex; align-items: center; padding: .5rem 0; }.cb { width: 1.1rem; height: 1.1rem; border-radius: .25rem; border: 1px solid $line; display: flex; align-items: center; justify-content: center; margin-right: .5rem; box-sizing: border-box; }.cb.on { background: $primary; border-color: $primary; }.tick { font-size: .8rem; color: $surface; line-height: 1; }.rm-t { font-size: .8rem; color: $muted; }.clear { font-size: .8rem; color: $muted; padding: .5rem 0; }
.login-btn { line-height: 3rem; border-radius: .6rem; background: $primary; color: $surface; font-size: 1rem; font-weight: 700; margin-top: .6rem; }.login-btn::after { border: 0; }.login-btn[disabled] { opacity: .6; }.err { display: block; margin-top: .9rem; font-size: .85rem; color: $danger; line-height: 1.6; }
</style>
