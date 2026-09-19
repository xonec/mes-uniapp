<script>
export default {
    onLaunch() {
        // 锁定竖屏
        // #ifdef APP-PLUS
        plus.screen.lockOrientation('portrait-primary')
        // #endif
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
