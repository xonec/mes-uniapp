<script>
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
            if (!uni.getStorageSync('mes_user')) {
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
page {
    background-color: #F2F4F3;
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', sans-serif;
    color: #1f2622;
}
</style>
