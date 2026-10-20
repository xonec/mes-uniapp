<template>
    <view class="vk-shell">
        <!-- P2 批 2：tab 壳页。开关 true 时渲染 vk 组件，false 时渲染旧内容；tabBar 不动。 -->
        <MyPage v-if="vkEnabled" :show-tick="vkShowTick" :refresh-tick="vkRefreshTick" />
        <template v-else>
            <view class="fw-page">
        <view class="profile fw-card"><view class="avatar">{{ avatarChar }}</view><view class="profile-info"><text class="profile-name">{{ me.nickname || me.username || '未登录' }}</text><text class="fw-badge">{{ checking ? '确认身份中…' : roleText }}</text></view></view>
        <view v-if="profileError" class="fw-notice warning">{{ profileError }}<text class="retry" @tap="refreshProfile">重新确认</text></view>
        <view class="menu-group"><text class="menu-title">个人出勤</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goAttendance"><view><text>我的考勤</text><text class="cell-note">查看出勤明细与统计</text></view><uni-icons class="menu-arrow" type="right" size="14" color="#5F6A65"></uni-icons></view></view></view>
        <view class="menu-group"><text class="menu-title">账户</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goChangePassword"><view><text>修改密码</text><text class="cell-note">更新账户登录密码</text></view><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view></view></view>
        <view class="menu-group"><text class="menu-title">计算与档案</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goCalculation"><text>包材计算</text><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view><view class="menu-cell" @tap="goHistory"><text>计算历史</text><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view><view class="menu-cell" @tap="goArchive"><text>产品档案</text><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view><view class="menu-cell" @tap="goSettingsOcr"><text>识别设置与我的 Key</text><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view></view></view>
        <view class="menu-group"><text class="menu-title">录入工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goOrderSheet"><view><text>指令单录入</text><text class="cell-note">拍照识别指令单，录入生产订单与产品资料</text></view><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view></view></view>
        <view v-if="isAdmin" class="menu-group"><text class="menu-title">管理工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goUserManage"><text>用户管理</text><uni-icons type="right" size="14" color="#5F6A65"></uni-icons></view></view></view>
        <button class="logout-button" @tap="doLogout">退出登录</button>
            </view>
        </template>
    </view>
</template>
<script>
import { getUser, logout, checkLogin, isLoggedIn } from '@/utils/auth.js'
import { PAGE_SWITCH, openPage } from '@/utils/vk-migration.js'
import MyPage from '@/components/vk/pages/MyPage.vue'
export default {
    components: { MyPage },
    data() {
        return {
            vkEnabled: PAGE_SWITCH['me'],
            vkShowTick: 0,
            vkRefreshTick: 0,
            vkFirstShow: true,
            me: getUser() || {},
            isAdmin: false,
            checking: false,
            profileError: ''
        }
    },
    computed: {
        avatarChar() { return String(this.me.nickname || this.me.username || '?').slice(0, 1).toUpperCase() },
        roleText() { return this.profileError ? '身份待确认' : this.isAdmin ? '管理员' : '现场用户' }
    },
    onShow() {
        if (this.vkEnabled) {
            // 首屏由组件 mounted 取数；之后每次进入 tab 通过 tick 触发刷新
            if (this.vkFirstShow) { this.vkFirstShow = false; return }
            this.vkShowTick += 1
            return
        }
        if (!isLoggedIn()) { uni.reLaunch({ url: '/pages/login/login' }); return }
        this.me = getUser() || {}
        this.refreshProfile()
    },
    onPullDownRefresh() {
        if (this.vkEnabled) { this.vkRefreshTick += 1; return }
        uni.stopPullDownRefresh()
    },
    methods: {
        async refreshProfile() {
            if (this.checking) return
            this.checking = true; this.profileError = ''; this.isAdmin = false
            try { const info = await checkLogin(); if (info) { const user = { ...getUser(), role: info.role || [] }; uni.setStorageSync('mes_user', user); this.me = user; this.isAdmin = user.role.includes('admin') } }
            catch (error) { this.profileError = '身份确认失败，管理入口暂不可用。' }
            finally { this.checking = false }
        },
        goAttendance() { uni.switchTab({ url: '/pages/operations/attendance' }) },
        goChangePassword() { uni.navigateTo({ url: '/pages/change-password/change-password' }) },
        goCalculation() { openPage('materials') },
        goHistory() { openPage('history') },
        goArchive() { openPage('archive') },
        goUserManage() { uni.navigateTo({ url: '/pages/user-manage/user-manage' }) },
        goSettingsOcr() { openPage('settings-ocr') },
        goOrderSheet() { openPage('order-sheet', { purpose: 'order' }) },
        doLogout() { uni.showModal({ title: '退出登录', content: '确认退出当前账户？', success: result => { if (result.confirm) { logout(); uni.reLaunch({ url: '/pages/login/login' }) } } }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.profile { display: flex; align-items: center;  padding: 24rpx; border-left: 8rpx solid $primary; }.avatar { flex-shrink: 0; width: 108.8rpx; height: 108.8rpx; border-radius: 27.2rpx; background: $primary-soft; color: $primary; font-size: 44.8rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; }.profile-info { flex: 1; min-width: 0; }.profile-name { display: block; font-weight: 700; font-size: 36.8rpx; margin-bottom: 12rpx; overflow-wrap: anywhere; }
.menu-group { margin-top: 24rpx; }.menu-title { display: block; color: $muted; font-size: 25.6rpx; margin: 0 4rpx 12rpx; }.menu-card { padding: 0 20rpx; }.menu-cell { min-height: 96rpx; padding: 16rpx 0; display: flex; align-items: center; justify-content: space-between;  border-bottom: 1px solid $line; font-size: 30.4rpx; }.menu-cell:last-child { border-bottom: 0; }.cell-note { display: block; font-size: 24rpx; color: $muted; margin-top: 8rpx; line-height: 1.5; }.logout-button { margin: 32rpx 0; background: $surface; color: $danger; border-radius: 22.4rpx; font-size: 28.8rpx; line-height: 89.6rpx; }.logout-button::after { border: 0; }.retry { display: inline-block; padding: 6rpx 12rpx; color: $primary; }

.profile-info { margin-left: 20rpx; }
.menu-arrow { margin-left: 16rpx; }

</style>
