<template>
    <view class="page">
        <!-- 顶部栏 -->
        <view class="topbar">
            <text class="tb-title">用户管理</text>
            <view class="tb-right">
                <text class="tb-me">{{ me.nickname || me.username }}</text>
                <text class="tb-pwd" @tap="goChangePassword">改密码</text>
                <text class="tb-logout" @tap="doLogout">退出</text>
            </view>
        </view>

        <!-- 新建用户 -->
        <view class="card">
            <view class="card-title">新建账号</view>
            <view class="field">
                <text class="lbl">账号</text>
                <input class="inp" v-model="form.username" type="text" placeholder="登录账号（字母数字）" />
            </view>
            <view class="field">
                <text class="lbl">密码</text>
                <input class="inp" v-model="form.password" type="text" password placeholder="至少 6 位" />
            </view>
            <view class="field">
                <text class="lbl">昵称</text>
                <input class="inp" v-model="form.nickname" type="text" placeholder="显示名（可空）" />
            </view>
            <view class="field">
                <text class="lbl">角色</text>
                <view class="seg">
                    <view class="seg-item" :class="{ active: form.role === 'user' }" @tap="form.role = 'user'">普通用户</view>
                    <view class="seg-item" :class="{ active: form.role === 'admin' }" @tap="form.role = 'admin'">管理员</view>
                </view>
            </view>
            <button class="btn primary" :disabled="creating" @tap="createUser">{{ creating ? '创建中…' : '创建账号' }}</button>
            <text class="err" v-if="formMsg">{{ formMsg }}</text>
        </view>

        <!-- 帆软报表地址（仅安卓 App 的「从帆软(内网)获取」使用） -->
        <view class="card">
            <view class="card-title">帆软报表地址</view>
            <view class="field">
                <text class="lbl">地址</text>
                <input class="inp" v-model="frBase" type="text" placeholder="http://内网IP:端口/webroot/decision/view/report" />
            </view>
            <view class="fr-actions">
                <button class="btn" @tap="saveFrBase">保存</button>
                <button class="btn" @tap="resetFrBase">恢复默认</button>
            </view>
            <text class="err" v-if="frMsg">{{ frMsg }}</text>
            <view class="tip">仅安卓 App 的「从帆软获取」使用；改服务器/IP 时在此设置，无需重新打包。</view>
        </view>

        <!-- 用户列表 -->
        <view class="card">
            <view class="card-title">账号列表<text class="count">{{ users.length }}</text></view>
            <view v-if="loading" class="empty">加载中…</view>
            <view v-else-if="users.length === 0" class="empty">暂无账号</view>
            <view v-for="u in users" :key="u._id" class="user-row" :class="{ disabled: u.status !== 0 }">
                <view class="u-main">
                    <text class="u-name">{{ u.nickname || u.username }}</text>
                    <text class="u-sub">@{{ u.username }}</text>
                </view>
                <view class="u-tags">
                    <text class="tag" :class="roleClass(u.role)">{{ roleText(u.role) }}</text>
                    <text class="tag" :class="u.status === 0 ? 'on' : 'off'">{{ u.status === 0 ? '启用' : '禁用' }}</text>
                </view>
                <view class="u-actions">
                    <text class="act" @tap="toggleStatus(u)">{{ u.status === 0 ? '禁用' : '启用' }}</text>
                    <text class="act" @tap="resetPwd(u)">重置密码</text>
                    <text class="act danger" @tap="removeUser(u)">删除</text>
                </view>
            </view>
        </view>
    </view>
</template>

<script>
import { getUser, logout, checkLogin, resetPassword, addUser, updateUser } from '@/utils/auth.js'
import { callCloud } from '@/utils/cloud-call.js'
import { getReportBase, setReportBase } from '@/utils/fr-config.js'

export default {
    data() {
        return {
            me: getUser() || {},
            form: { username: '', password: '', nickname: '', role: 'user' },
            creating: false,
            formMsg: '',
            users: [],
            loading: false,
            frBase: '',
            frMsg: ''
        }
    },
    async onShow() {
        // 服务端复核管理员身份（防本地篡改 role）
        const info = await checkLogin().catch(() => null)
        if (!info || (info.role || []).indexOf('admin') < 0) {
            uni.showToast({ title: '无权限', icon: 'none' })
            setTimeout(() => uni.reLaunch({ url: '/pages/operations/workbench' }), 800)
            return
        }
        const u = getUser() || {}
        u.role = info.role || []
        uni.setStorageSync('mes_user', u)
        this.me = u
        this.frBase = getReportBase()
        this.loadUsers()
    },
    methods: {
        roleText(role) {
            return (role || []).indexOf('admin') >= 0 ? '管理员' : '普通用户'
        },
        roleClass(role) {
            return (role || []).indexOf('admin') >= 0 ? 'admin' : 'user'
        },
        async loadUsers() {
            this.loading = true
            try {
                const r = await callCloud('user-admin', 'listUsers')
                this.users = r.list || []
            } catch (e) {
                uni.showToast({ title: e.message || '加载失败', icon: 'none' })
            } finally {
                this.loading = false
            }
        },
        async createUser() {
            const username = (this.form.username || '').trim()
            const password = this.form.password || ''
            if (!username) { this.formMsg = '请输入账号'; return }
            if (password.length < 6) { this.formMsg = '密码至少 6 位'; return }
            this.creating = true
            this.formMsg = ''
            try {
                await addUser({
                    username,
                    password,
                    nickname: (this.form.nickname || '').trim() || username,
                    role: [this.form.role],
                    status: 0
                })
                uni.showToast({ title: '创建成功', icon: 'success' })
                this.form = { username: '', password: '', nickname: '', role: 'user' }
                this.loadUsers()
            } catch (e) {
                this.formMsg = e.message || '创建失败'
            } finally {
                this.creating = false
            }
        },
        toggleStatus(u) {
            // uni-id status：0=正常 1=封禁
            const next = u.status === 0 ? 1 : 0
            uni.showModal({
                title: next === 1 ? '禁用确认' : '启用确认',
                content: `确定${next === 1 ? '禁用' : '启用'}账号 @${u.username} 吗？`,
                success: async (res) => {
                    if (!res.confirm) return
                    try {
                        await updateUser({ id: u._id, status: next })
                        uni.showToast({ title: next === 1 ? '已禁用' : '已启用', icon: 'none' })
                        this.loadUsers()
                    } catch (e) {
                        uni.showToast({ title: e.message || '操作失败', icon: 'none' })
                    }
                }
            })
        },
        removeUser(u) {
            uni.showModal({
                title: '删除确认',
                content: `确定删除账号 @${u.username} 吗？（注销后不可登录）`,
                success: async (res) => {
                    if (!res.confirm) return
                    try {
                        await updateUser({ id: u._id, status: 4 }) // uni-id 注销
                        uni.showToast({ title: '已删除', icon: 'none' })
                        this.loadUsers()
                    } catch (e) {
                        uni.showToast({ title: e.message || '删除失败', icon: 'none' })
                    }
                }
            })
        },
        resetPwd(u) {
            uni.showModal({
                title: '重置密码',
                content: `为 @${u.username} 设置新密码（至少 6 位）`,
                editable: true,
                placeholderText: '请输入新密码',
                success: async (res) => {
                    if (!res.confirm) return
                    const pwd = String(res.content || '').trim()
                    if (pwd.length < 6) {
                        uni.showToast({ title: '新密码至少 6 位', icon: 'none' })
                        return
                    }
                    try {
                        await resetPassword(u._id, pwd)
                        uni.showToast({ title: '已重置，请告知其用新密码登录', icon: 'none' })
                    } catch (e) {
                        uni.showToast({ title: e.message || '重置失败', icon: 'none' })
                    }
                }
            })
        },
        goChangePassword() {
            uni.navigateTo({ url: '/pages/change-password/change-password' })
        },
        saveFrBase() {
            try {
                this.frBase = setReportBase(this.frBase)
                this.frMsg = '已保存'
                uni.showToast({ title: '已保存', icon: 'success' })
            } catch (e) {
                this.frMsg = e.message || '保存失败'
            }
        },
        resetFrBase() {
            this.frBase = setReportBase('')
            this.frMsg = '已恢复默认'
            uni.showToast({ title: '已恢复默认', icon: 'none' })
        },
        doLogout() {
            logout()
            uni.reLaunch({ url: '/pages/login/login' })
        }
    }
}
</script>

<style scoped>
.page { padding: 24rpx; min-height: 100vh; background: #F2F4F3; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 6rpx 20rpx; }
.tb-title { font-size: 32rpx; font-weight: 700; color: #1f2622; }
.tb-right { display: flex; align-items: center;  }
.tb-me { font-size: 24rpx; color: #5F6A65; }
.tb-pwd { font-size: 24rpx; color: #0B7263; padding: 6rpx 12rpx; background: #E6F4F1; border-radius: 999rpx; }
.tb-logout { font-size: 24rpx; color: #B23B37; padding: 6rpx 12rpx; background: #FBEAE9; border-radius: 999rpx; }

.card { background: #fff; border-radius: 16rpx; padding: 22rpx; margin-bottom: 12rpx; box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.03); }
.card-title { font-size: 28rpx; font-weight: 700; color: #1f2622; margin-bottom: 12rpx; display: flex; align-items: center;  }
.count { font-size: 22rpx; color: #fff; background: #008577; border-radius: 999rpx; padding: 0 14rpx; }

.field { display: flex; align-items: center; background: #F2F4F3; border-radius: 12rpx; padding: 0 12rpx; height: 84rpx; margin-bottom: 14rpx; }
.lbl { width: 90rpx; font-size: 26rpx; color: #5F6A65; flex-shrink: 0; }
.inp { flex: 1; height: 84rpx; font-size: 28rpx; background: transparent; }
.seg { flex: 1; display: flex; background: #F2F4F3; border-radius: 12rpx; padding: 4rpx;  }
.seg-item { flex: 1; text-align: center; font-size: 26rpx; color: #5F6A65; padding: 12rpx 0; border-radius: 10rpx; }
.seg-item.active { background: #008577; color: #fff; font-weight: 700; }

.btn { font-size: 28rpx; border-radius: 12rpx; height: 84rpx; line-height: 84rpx; background: #F2F4F3; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; font-weight: 700; }
.btn[disabled] { opacity: 0.5; }
.err { display: block; margin-top: 12rpx; font-size: 24rpx; color: #B23B37; }
.fr-actions { display: flex;  }
.fr-actions .btn { flex: 1; }
.tip { margin-top: 12rpx; font-size: 22rpx; color: #5F6A65; line-height: 1.5; }

.empty { text-align: center; color: #5F6A65; padding: 28rpx; font-size: 26rpx; }

.user-row { display: flex; align-items: center;  padding: 20rpx 6rpx; border-bottom: 1rpx solid #F0F3F1; }
.user-row:last-child { border-bottom: none; }
.user-row.disabled { opacity: 0.55; }
.u-main { flex: 1; min-width: 0; }
.u-name { font-size: 28rpx; font-weight: 600; color: #1f2622; display: block; }
.u-sub { font-size: 22rpx; color: #5F6A65; }
.u-tags { display: flex; flex-direction: column;  flex-shrink: 0; }
.tag { font-size: 22rpx; padding: 2rpx 12rpx; border-radius: 999rpx; background: #F2F4F3; color: #5F6A65; text-align: center; }
.tag.admin { background: #E6F4F1; color: #0B7263; }
.tag.user { background: #F2F4F3; color: #5F6A65; }
.tag.on { background: #E6F4F1; color: #0B7263; }
.tag.off { background: #F2F4F3; color: #5F6A65; }
.u-actions { display: flex; flex-direction: column;  flex-shrink: 0; }
.act { font-size: 24rpx; color: #0B7263; text-align: center; padding: 4rpx 14rpx; background: #F2F4F3; border-radius: 10rpx; }
.act.danger { color: #B23B37; background: #FBEBEA; }

.tb-right text + text { margin-left: 12rpx; }
.card-title .count { margin-left: 12rpx; }
.seg-item + .seg-item { margin-left: 4rpx; }
.fr-actions button + button { margin-left: 12rpx; }
.user-row .u-tags, .user-row .u-actions { margin-left: 14rpx; }
.u-tags .tag + .tag { margin-top: 6rpx; }
.u-actions .act + .act { margin-top: 6rpx; }

</style>
