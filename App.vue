<script>
import { isLoggedIn } from '@/utils/auth.js'

// #ifdef APP-PLUS
import checkUpdate from '@/uni_modules/uni-upgrade-center-app/utils/check-update'
// #endif

export default {
    onLaunch() {
        // #ifdef APP-PLUS
        // 锁定竖屏
        plus.screen.lockOrientation('portrait-primary')
        // 官方升级中心：wgt 静默更新 + apk 弹窗（升级中心未配置/云端未就绪时静默失败，不影响启动）
        // 标准调试基座拿不到应用版本号，直接跳过检查，避免无谓报错
        try {
            if (plus.runtime.version) {
                checkUpdate().catch((e) => {
                    console.warn('[upgrade-center] 检查更新失败（忽略）：', e && (e.message || e))
                })
            }
        } catch (e) { /* ignore */ }
        // #endif

        // #ifdef MP-WEIXIN
        this.checkUpdate()
        // 分享直进等场景：未登录先跳登录，避免目标页先渲染导致白屏
        try {
            if (!isLoggedIn()) {
                uni.reLaunch({ url: '/pages/login/login' })
            }
        } catch (e) { /* ignore */ }
        // #endif
    },
    methods: {
        checkUpdate() {
            const um = uni.getUpdateManager()
            um.onCheckForUpdate((res) => {
                // res.hasUpdate 仅表示后台发现新版本，不触发下载提示
                console.log('[update] hasUpdate =', res.hasUpdate)
            })
            um.onUpdateReady(() => {
                uni.showModal({
                    title: '发现新版本',
                    content: '已为您下载好新版本，重启后生效',
                    confirmText: '立即重启',
                    success: (r) => { if (r.confirm) um.applyUpdate() }
                })
            })
            um.onUpdateFailed(() => {
                uni.showToast({ title: '新版本下载失败，请检查网络', icon: 'none' })
            })
        }
    },
    globalData: {}
}
</script>

<style>
/* 设计令牌：CSS 变量必须在全局样式里声明（页面 scoped 样式无法声明 page 级变量）。
   使用方：styles/field-work.scss、components/ui/*、现场端页面；全部带 fallback，令牌缺失也不改变现有视觉。 */
page {
    background-color: #F2F4F3;
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', sans-serif;
    color: #1f2622;

    /* 间距 8 档（rpx） */
    --sp-4: 4rpx;
    --sp-8: 8rpx;
    --sp-12: 12rpx;
    --sp-16: 16rpx;
    --sp-20: 20rpx;
    --sp-24: 24rpx;
    --sp-32: 32rpx;
    --sp-40: 40rpx;

    /* 字号阶梯（rpx） */
    --fs-44: 44rpx;
    --fs-32: 32rpx;
    --fs-30: 30rpx;
    --fs-28: 28rpx;
    --fs-24: 24rpx;
    --fs-22: 22rpx;
    --fs-52: 52rpx; /* 品牌字例外，仅登录页 */

    /* 圆角 */
    --radius-card: 16rpx;
    --radius-button: 12rpx;
    --radius-badge: 8rpx;

    /* 状态文字色 ink / 浅底；填充仍用 $primary/$warning/$danger/$muted */
    --state-primary: #0B7263; /* 状态文字色（徽标/tag/标题主态；品牌按钮仍用 $primary #008577） */
    --state-primary-soft: #E6F4F1;
    --state-warning: #A64B00;
    --state-warning-soft: #FBEEE3;
    --state-neutral: #5F6A65;
    --state-neutral-soft: #F2F4F3;
    --state-danger: #B23B37;
    --state-danger-soft: #FBEBEA;

    /* 表面层级：紧凑版式卡片浅底（输入格仍用 $surface 白），界面 2026-10-21 定稿 */
    --surface-soft: #F7F9F8;
}
</style>
