<template>
    <view class="fw-page">
        <view class="fw-header"><text class="fw-eyebrow">个人中心</text><text class="fw-title">我的</text></view>
        <view class="profile fw-card"><view class="avatar">{{ avatarChar }}</view><view class="profile-info"><text class="profile-name">{{ me.nickname || me.username || '未登录' }}</text><text class="fw-badge">{{ checking ? '确认身份中…' : roleText }}</text></view></view>
        <view v-if="profileError" class="fw-notice warning">{{ profileError }}<text class="retry" @tap="refreshProfile">重新确认</text></view>
        <view class="menu-group"><text class="menu-title">账户</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goChangePassword"><view><text>修改密码</text><text class="cell-note">更新账户登录密码</text></view><text class="arrow">›</text></view></view></view>
        <view class="menu-group"><text class="menu-title">录入工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goOrderSheet"><view><text>生产订单录入</text><text class="cell-note">核对客户、材料及上托要求</text></view><text class="arrow">›</text></view><view class="menu-cell" @tap="goBomImport"><view><text>产品物料录入</text><text class="cell-note">建立可复用的产品档案</text></view><text class="arrow">›</text></view></view></view>
        <view v-if="isAdmin" class="menu-group"><text class="menu-title">管理工具</text><view class="fw-card menu-card"><view class="menu-cell" @tap="goUserManage"><text>用户管理</text><text class="arrow">›</text></view><view class="menu-cell" @tap="goSettingsOcr"><text>识别设置</text><text class="arrow">›</text></view></view></view>
        <button class="logout-button" @tap="doLogout">退出登录</button>
    </view>
</template>
<script>
import { getUser, logout, checkLogin } from '@/utils/auth.js'
export default {
    data() { return { me: getUser() || {}, isAdmin: false, checking: false, profileError: '' } },
    computed: {
        avatarChar() { return String(this.me.nickname || this.me.username || '?').slice(0, 1).toUpperCase() },
        roleText() { return this.profileError ? '身份待确认' : this.isAdmin ? '管理员' : '现场用户' }
    },
    onShow() { if (!getUser()) { uni.reLaunch({ url: '/pages/login/login' }); return }; this.me = getUser(); this.refreshProfile() },
    methods: {
        async refreshProfile() {
            if (this.checking) return
            this.checking = true; this.profileError = ''; this.isAdmin = false
            try { const info = await checkLogin(); if (info) { const user = { ...getUser(), role: info.role || [] }; uni.setStorageSync('mes_user', user); this.me = user; this.isAdmin = user.role.includes('admin') } }
            catch (error) { this.profileError = '身份确认失败，管理入口暂不可用。' }
            finally { this.checking = false }
        },
        goChangePassword() { uni.navigateTo({ url: '/pages/change-password/change-password' }) },
        goUserManage() { uni.navigateTo({ url: '/pages/user-manage/user-manage' }) },
        goSettingsOcr() { uni.navigateTo({ url: '/pages/settings-ocr/settings-ocr' }) },
        goOrderSheet() { uni.navigateTo({ url: '/pages/order-sheet/order-sheet?purpose=order' }) },
        goBomImport() { uni.navigateTo({ url: '/pages/order-sheet/order-sheet?purpose=bom' }) },
        doLogout() { uni.showModal({ title: '退出登录', content: '确认退出当前账户？', success: result => { if (result.confirm) { logout(); uni.reLaunch({ url: '/pages/login/login' }) } } }) }
    }
}
</script>
<style lang="scss" scoped>
@import '@/styles/field-work.scss';
.profile { display: flex; align-items: center; gap: 1rem; padding: 1.3rem; border-left: .25rem solid $primary; }.avatar { flex-shrink: 0; width: 3.4rem; height: 3.4rem; border-radius: .85rem; background: $primary-soft; color: $primary; font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; justify-content: center; }.profile-info { flex: 1; min-width: 0; }.profile-name { display: block; font-weight: 700; font-size: 1.15rem; margin-bottom: .5rem; overflow-wrap: anywhere; }
.menu-group { margin-top: 1.3rem; }.menu-title { display: block; color: $muted; font-size: .8rem; margin: 0 .2rem .6rem; }.menu-card { padding: 0 1rem; }.menu-cell { min-height: 3.5rem; padding: .8rem 0; display: flex; align-items: center; justify-content: space-between; gap: .8rem; border-bottom: 1px solid $line; font-size: .95rem; }.menu-cell:last-child { border-bottom: 0; }.cell-note { display: block; font-size: .75rem; color: $muted; margin-top: .35rem; line-height: 1.5; }.arrow { color: $muted; font-size: 1.3rem; }.logout-button { margin: 1.5rem 0; background: $surface; color: $danger; border-radius: .7rem; font-size: .9rem; line-height: 2.8rem; }.logout-button::after { border: 0; }.retry { display: inline-block; padding: .3rem .5rem; color: $primary; }
</style>
