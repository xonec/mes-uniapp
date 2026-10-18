<template>
    <view class="fw-page">
        <view class="profile fw-card"><view class="avatar">{{ avatarChar }}</view><view class="profile-info"><text class="profile-name">{{ me.nickname || me.username || '未登录' }}</text><text class="fw-badge">{{ checking ? '确认身份中…' : roleText }}</text></view></view>
        <view v-if="profileError" class="fw-notice warning">{{ profileError }}<text class="retry" @tap="refreshProfile">重新确认</text></view>
        <view class="menu-group"><text class="menu-title">个人出勤</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goAttendance"><view><text>我的考勤</text><text class="cell-note">查看出勤、修改班次工序并保存记录</text></view><text class="arrow">›</text></view></view></view>
        <view class="menu-group"><text class="menu-title">账户</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goChangePassword"><view><text>修改密码</text><text class="cell-note">更新账户登录密码</text></view><text class="arrow">›</text></view></view></view>
        <view class="menu-group"><text class="menu-title">计算与档案</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goCalculation"><text>包材计算</text><text class="arrow">›</text></view><view class="menu-cell" @tap="goHistory"><text>计算历史</text><text class="arrow">›</text></view><view class="menu-cell" @tap="goArchive"><text>产品档案</text><text class="arrow">›</text></view><view class="menu-cell" @tap="goSettingsOcr"><text>识别设置与我的 Key</text><text class="arrow">›</text></view></view></view>
        <view class="menu-group"><text class="menu-title">录入工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goOrderSheet"><view><text>指令单录入</text><text class="cell-note">拍照识别指令单，录入生产订单与产品资料</text></view><text class="arrow">›</text></view></view></view>
        <view v-if="isAdmin" class="menu-group"><text class="menu-title">管理工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goUserManage"><text>用户管理</text><text class="arrow">›</text></view></view></view>
        <button class="logout-button" @tap="doLogout">退出登录</button>
    </view>
</template>
<script>
import { getUser, logout, checkLogin, isLoggedIn } from '@/utils/auth.js'
export default {
    data() { return { me: getUser() || {}, isAdmin: false, checking: false, profileError: '' } },
    computed: {
        avatarChar() { return String(this.me.nickname || this.me.username || '?').slice(0, 1).toUpperCase() },
        roleText() { return this.profileError ? '身份待确认' : this.isAdmin ? '管理员' : '现场用户' }
    },
    onShow() { if (!isLoggedIn()) { uni.reLaunch({ url: '/pages/login/login' }); return }; this.me = getUser() || {}; this.refreshProfile() },
    methods: {
        async refreshProfile() {
            if (this.checking) return
            this.checking = true; this.profileError = ''; this.isAdmin = false
            try { const info = await checkLogin(); if (info) { const user = { ...getUser(), role: info.role || [] }; uni.setStorageSync('mes_user', user); this.me = user; this.isAdmin = user.role.includes('admin') } }
            catch (error) { this.profileError = '身份确认失败，管理入口暂不可用。' }
            finally { this.checking = false }
        },
        goAttendance() { uni.navigateTo({ url: '/pages/operations/attendance' }) },
        goChangePassword() { uni.navigateTo({ url: '/pages/change-password/change-password' }) },
        goCalculation() { uni.navigateTo({ url: '/pages/materials/materials' }) },
        goHistory() { uni.navigateTo({ url: '/pages/history/history' }) },
        goArchive() { uni.navigateTo({ url: '/pages/archive/archive' }) },
        goUserManage() { uni.navigateTo({ url: '/pages/user-manage/user-manage' }) },
        goSettingsOcr() { uni.navigateTo({ url: '/pages/settings-ocr/settings-ocr' }) },
        goOrderSheet() { uni.navigateTo({ url: '/pages/order-sheet/order-sheet?purpose=order' }) },
        doLogout() { uni.showModal({ title: '退出登录', content: '确认退出当前账户？', success: result => { if (result.confirm) { logout(); uni.reLaunch({ url: '/pages/login/login' }) } } }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.profile { display: flex; align-items: center; gap: 32rpx; padding: 41.6rpx; border-left: 8rpx solid $primary; }.avatar { flex-shrink: 0; width: 108.8rpx; height: 108.8rpx; border-radius: 27.2rpx; background: $primary-soft; color: $primary; font-size: 44.8rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; }.profile-info { flex: 1; min-width: 0; }.profile-name { display: block; font-weight: 700; font-size: 36.8rpx; margin-bottom: 16rpx; overflow-wrap: anywhere; }
.menu-group { margin-top: 41.6rpx; }.menu-title { display: block; color: $muted; font-size: 25.6rpx; margin: 0 6.4rpx 19.2rpx; }.menu-card { padding: 0 32rpx; }.menu-cell { min-height: 112rpx; padding: 25.6rpx 0; display: flex; align-items: center; justify-content: space-between; gap: 25.6rpx; border-bottom: 1px solid $line; font-size: 30.4rpx; }.menu-cell:last-child { border-bottom: 0; }.cell-note { display: block; font-size: 24rpx; color: $muted; margin-top: 11.2rpx; line-height: 1.5; }.arrow { color: $muted; font-size: 41.6rpx; }.logout-button { margin: 48rpx 0; background: $surface; color: $danger; border-radius: 22.4rpx; font-size: 28.8rpx; line-height: 89.6rpx; }.logout-button::after { border: 0; }.retry { display: inline-block; padding: 9.6rpx 16rpx; color: $primary; }
</style>
