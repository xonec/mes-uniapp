// App 端版本检查（仅 App 生效；小程序/H5 会被条件编译剔除）
//
// 流程：启动时取云端最新版本号，比自己新则弹窗提示，确认后打开下载地址。
// 失败一律静默（不影响启动），因为版本检查只是锦上添花。

import { callCloud } from './cloud-call.js'

// 版本名比较：'1.2.0' vs '1.10.0' → -1（按段数值比较，不是字符串比较）
export function compareVersion(a, b) {
    const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0)
    const y = String(b || '').split('.').map(n => parseInt(n, 10) || 0)
    const len = Math.max(x.length, y.length)
    for (let i = 0; i < len; i++) {
        const d = (x[i] || 0) - (y[i] || 0)
        if (d) return d > 0 ? 1 : -1
    }
    return 0
}

export async function checkAppUpdate() {
    // #ifndef APP-PLUS
    return
    // #endif

    // #ifdef APP-PLUS
    try {
        let current = ''
        try { current = plus.runtime.version || '' } catch (e) {}
        if (!current) return

        const r = await callCloud('app-version', 'get')
        if (!r || !r.versionName) return
        if (compareVersion(r.versionName, current) <= 0) return

        uni.showModal({
            title: '发现新版本 v' + r.versionName,
            content: (r.notes ? r.notes + '\n\n' : '') + '当前版本 v' + current,
            confirmText: '立即更新',
            cancelText: r.force ? '退出' : '稍后',
            success: (res) => {
                if (!res.confirm) return
                try {
                    plus.runtime.openURL(r.url)
                } catch (e) {
                    uni.showToast({ title: '打开下载页失败', icon: 'none' })
                }
            }
        })
    } catch (e) {
        // 版本检查失败不打扰用户
        console.warn('[app-version] 检查更新失败（忽略）：', e && e.message)
    }
    // #endif
}
