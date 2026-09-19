<template>
    <view class="login-page">
        <view class="login-box">
            <view class="logo">
                <text class="logo-t">助手</text>
                <text class="logo-s">请登录后使用</text>
            </view>
            <view class="field">
                <text class="lbl">账号</text>
                <input class="inp" v-model="username" type="text" placeholder="请输入账号" confirm-type="next" />
            </view>
            <view class="field">
                <text class="lbl">密码</text>
                <input class="inp" v-model="password" type="password" placeholder="请输入密码" confirm-type="done" @confirm="doLogin" />
            </view>
            <button class="login-btn" :disabled="loading" @tap="doLogin">{{ loading ? '登录中…' : '登 录' }}</button>
            <text class="err" v-if="errMsg">{{ errMsg }}</text>
        </view>
    </view>
</template>

<script>
import { login, isLoggedIn } from '@/utils/auth.js'

export default {
    data() {
        return {
            username: '',
            password: '',
            loading: false,
            errMsg: ''
        }
    },
    onLoad() {
        // 已登录直接进主页（若带了分享批号则一起带过去）
        if (isLoggedIn()) {
            this.enterAfterLogin()
        }
    },
    methods: {
        // 登录后进入主页，若有暂存的分享批号则带上，让主页加载该批云端数据
        enterAfterLogin() {
            const shareBatch = uni.getStorageSync('mes-share-batch') || ''
            uni.removeStorageSync('mes-share-batch')
            const url = '/pages/materials/materials' + (shareBatch ? '?batchNo=' + shareBatch : '')
            uni.reLaunch({ url })
        },
        async doLogin() {
            const u = (this.username || '').trim()
            const p = this.password || ''
            if (!u || !p) { this.errMsg = '请输入账号和密码'; return }
            this.loading = true
            this.errMsg = ''
            try {
                await login(u, p)
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

<style scoped>
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #008577; }
.login-box { width: 82%; background: #fff; border-radius: 20rpx; padding: 48rpx 40rpx; box-shadow: 0 12rpx 40rpx rgba(0,0,0,0.15); }
.logo { text-align: center; margin-bottom: 40rpx; }
.logo-t { display: block; font-size: 40rpx; font-weight: 700; color: #1f2622; }
.logo-s { display: block; margin-top: 8rpx; font-size: 24rpx; color: #77827D; }
.field { display: flex; align-items: center; background: #F4F7F6; border-radius: 12rpx; padding: 0 20rpx; height: 88rpx; margin-bottom: 20rpx; }
.lbl { width: 90rpx; font-size: 26rpx; color: #77827D; flex-shrink: 0; }
.inp { flex: 1; height: 88rpx; font-size: 28rpx; background: transparent; }
.login-btn { height: 88rpx; line-height: 88rpx; border-radius: 12rpx; background: #008577; color: #fff; font-size: 30rpx; font-weight: 700; margin-top: 12rpx; }
.login-btn[disabled] { opacity: 0.6; }
.err { display: block; margin-top: 20rpx; font-size: 24rpx; color: #D9534F; text-align: center; }
</style>
