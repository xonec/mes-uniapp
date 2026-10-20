<template>
    <view class="page">
        <view class="card">
            <view class="card-title">修改密码</view>
            <view class="who">当前账号：{{ me.nickname || me.username }}</view>
            <view class="field">
                <text class="lbl">原密码</text>
                <input class="inp" v-model="oldPassword" type="text" password placeholder="请输入原密码" />
            </view>
            <view class="field">
                <text class="lbl">新密码</text>
                <input class="inp" v-model="newPassword" type="text" password placeholder="至少 6 位" />
            </view>
            <view class="field">
                <text class="lbl">确认</text>
                <input class="inp" v-model="confirmPassword" type="text" password placeholder="再输一次新密码" />
            </view>
            <button class="btn primary" :disabled="saving" @tap="submit">{{ saving ? '提交中…' : '确认修改' }}</button>
            <text class="err" v-if="msg">{{ msg }}</text>
            <view class="tip">修改成功后，其它设备上的登录将失效，需用新密码重新登录。</view>
        </view>
    </view>
</template>

<script>
import { changePassword, getUser, isLoggedIn } from '@/utils/auth.js'

export default {
    data() {
        return {
            me: getUser() || {},
            oldPassword: '',
            newPassword: '',
            confirmPassword: '',
            saving: false,
            msg: ''
        }
    },
    onLoad() {
        if (!isLoggedIn()) {
            uni.reLaunch({ url: '/pages/login/login' })
            return
        }
        this.me = getUser() || {}
    },
    methods: {
        async submit() {
            const o = this.oldPassword || ''
            const n = this.newPassword || ''
            const c = this.confirmPassword || ''
            if (!o) { this.msg = '请输入原密码'; return }
            if (n.length < 6) { this.msg = '新密码至少 6 位'; return }
            if (n !== c) { this.msg = '两次输入的新密码不一致'; return }
            if (n === o) { this.msg = '新密码不能与原密码相同'; return }
            this.saving = true
            this.msg = ''
            try {
                await changePassword(o, n)
                uni.showToast({ title: '密码已修改', icon: 'success' })
                setTimeout(() => uni.navigateBack({ delta: 1 }), 800)
            } catch (e) {
                this.msg = e.message || '修改失败'
            } finally {
                this.saving = false
            }
        }
    }
}
</script>

<style scoped>
.page { padding: 12rpx; min-height: 100vh; background: #F2F4F3; }
.card { background: #fff; border-radius: 16rpx; padding: 16rpx; box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.03); }
.card-title { font-size: 28rpx; font-weight: 700; color: #1f2622; margin-bottom: 6rpx; }
.who { font-size: 24rpx; color: #5F6A65; margin-bottom: 20rpx; }
.field { display: flex; align-items: center; background: #F4F7F6; border-radius: 12rpx; padding: 0 12rpx; height: 84rpx; margin-bottom: 14rpx; }
.lbl { width: 110rpx; font-size: 24rpx; color: #5F6A65; flex-shrink: 0; }
.inp { flex: 1; height: 84rpx; font-size: 28rpx; background: transparent; }
.btn { font-size: 28rpx; border-radius: 12rpx; height: 84rpx; line-height: 84rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; font-weight: 700; }
.btn[disabled] { opacity: 0.5; }
.err { display: block; margin-top: 12rpx; font-size: 24rpx; color: #B23B37; }
.tip { margin-top: 12rpx; font-size: 22rpx; color: #5F6A65; line-height: 1.5; }
</style>
