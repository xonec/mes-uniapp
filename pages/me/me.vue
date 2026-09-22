<template>
    <view class="page">
        <view class="profile">
            <view class="avatar">{{ avatarChar }}</view>
            <view class="pinfo">
                <text class="pname">{{ me.nickname || me.username || '未登录' }}</text>
                <text class="prole">{{ roleText }}</text>
            </view>
        </view>

        <view class="list">
            <view class="cell" @tap="goChangePassword">
                <text>修改密码</text>
                <text class="arrow">›</text>
            </view>
            <view class="cell" v-if="isAdmin" @tap="goUserManage">
                <text>用户管理</text>
                <text class="arrow">›</text>
            </view>
            <view class="cell danger" @tap="doLogout">
                <text>退出登录</text>
                <text class="arrow">›</text>
            </view>
        </view>
    </view>
</template>

<script>
// 我的页：账号信息 + 修改密码 / 用户管理（仅 admin）/ 退出登录
import { getUser, logout, checkLogin } from '@/utils/auth.js'

export default {
    data() {
        return {
            me: getUser() || {},
            isAdmin: false
        }
    },
    computed: {
        avatarChar() {
            const n = this.me.nickname || this.me.username || '?'
            return String(n).slice(0, 1).toUpperCase()
        },
        roleText() {
            return (this.me.role || []).indexOf('admin') >= 0 ? '管理员' : '普通用户'
        }
    },
    onShow() {
        if (!getUser()) {
            uni.reLaunch({ url: '/pages/login/login' })
            return
        }
        // 服务端复核角色（防本地篡改），并同步本地缓存
        checkLogin().then(info => {
            if (info) {
                const u = getUser() || {}
                u.role = info.role || []
                uni.setStorageSync('mes_user', u)
                this.me = u
                this.isAdmin = (info.role || []).indexOf('admin') >= 0
            }
        }).catch(() => {
            this.isAdmin = (this.me.role || []).indexOf('admin') >= 0
        })
    },
    methods: {
        goChangePassword() {
            uni.navigateTo({ url: '/pages/change-password/change-password' })
        },
        goUserManage() {
            uni.navigateTo({ url: '/pages/user-manage/user-manage' })
        },
        doLogout() {
            logout()
            uni.reLaunch({ url: '/pages/login/login' })
        }
    }
}
</script>

<style scoped>
.page { min-height: 100vh; background: #F2F4F3; }
.profile { display: flex; align-items: center; gap: 24rpx; background: #008577; padding: 40rpx 32rpx; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 50%; background: rgba(255, 255, 255, 0.2); color: #fff; font-size: 40rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.pinfo { flex: 1; }
.pname { display: block; font-size: 34rpx; font-weight: 700; color: #fff; }
.prole { display: block; margin-top: 6rpx; font-size: 22rpx; color: rgba(255, 255, 255, 0.8); }
.list { margin-top: 20rpx; background: #fff; border-radius: 16rpx; overflow: hidden; }
.cell { display: flex; justify-content: space-between; align-items: center; padding: 30rpx 28rpx; border-bottom: 1rpx solid #F0F3F1; font-size: 28rpx; color: #1f2622; }
.cell:last-child { border-bottom: none; }
.cell.danger { color: #D9534F; }
.arrow { color: #b6c2bd; font-size: 30rpx; }
</style>
