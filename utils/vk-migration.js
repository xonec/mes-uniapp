// P2 页面迁移开关与统一入口。
//
// 约定：新页面放 pages/vk/<模块>/<页面>.vue，旧页面冻结保留。
// PAGE_SWITCH 的 key 打开后，所有经 openPage 的入口自动跳到 vk 新页；改回 false 即回退旧页
// （同一构建内生效）。回退开关保留到 P4 旧页统一下线。
const ROUTES = {
    'operations.workbench': { legacy: '/pages/operations/workbench', tab: true },
    'operations.jobs': { legacy: '/pages/operations/jobs', tab: true },
    'operations.attendance': { legacy: '/pages/operations/attendance', tab: true },
    'operations.schedules': { legacy: '/pages/operations/schedules' },
    'operations.trace': { legacy: '/pages/operations/trace', vk: '/pages/vk/operations/trace' },
    'operations.reports': { legacy: '/pages/operations/reports', vk: '/pages/vk/operations/reports' },
    'operations.handovers': { legacy: '/pages/operations/handovers', vk: '/pages/vk/operations/handovers' },
    'operations.handover-detail': { legacy: '/pages/operations/handover-detail' },
    'operations.job-detail': { legacy: '/pages/operations/job-detail' },
    'operations.exceptions': { legacy: '/pages/operations/exceptions' },
    'operations.tools': { legacy: '/pages/operations/tools' },
    'materials': { legacy: '/pages/materials/materials' },
    'history': { legacy: '/pages/history/history' },
    'archive': { legacy: '/pages/archive/archive' },
    'order-sheet': { legacy: '/pages/order-sheet/order-sheet' },
    'settings-ocr': { legacy: '/pages/settings-ocr/settings-ocr' },
    'user-manage': { legacy: '/pages/user-manage/user-manage' },
    'change-password': { legacy: '/pages/change-password/change-password' },
    'me': { legacy: '/pages/me/me', tab: true }
}

/** true = 该页走 vk 新页面；false = 走旧页面。默认全关，批次验收后逐页打开。 */
export const PAGE_SWITCH = {
    'operations.workbench': false,
    'me': false,
    'operations.trace': false,
    'operations.reports': false,
    'operations.handovers': false
}

function query(params) {
    const keys = Object.keys(params || {}).filter(key => params[key] !== undefined && params[key] !== null)
    if (!keys.length) return ''
    return '?' + keys.map(key => key + '=' + encodeURIComponent(params[key])).join('&')
}

/** 按开关解析出实际 URL，供需要自己拼跳转的场景使用。 */
export function pageUrl(key, params = {}) {
    const route = ROUTES[key]
    if (!route) throw new Error('未登记的页面：' + key)
    const base = (PAGE_SWITCH[key] && route.vk) || route.legacy
    return base + query(params)
}

/** 统一跳转入口：tabBar 页用 switchTab，其余用 navigateTo 保留返回栈。 */
export function openPage(key, params = {}) {
    const route = ROUTES[key]
    if (!route) {
        uni.showToast({ title: '页面未登记：' + key, icon: 'none' })
        return
    }
    const url = pageUrl(key, params)
    if (route.tab) return uni.switchTab({ url })
    return uni.navigateTo({ url })
}
