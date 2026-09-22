// 帆软 FineReport 报表配置（用于获取批号每桶数量，App / 微信小程序 / H5 通用）
//
// base 只是「出厂默认值」：运行时优先读管理员在「用户管理」页设置的覆盖值（本地 storage），
// 换服务器 / 换 IP 时无需改代码重新打包。见文件末尾的 getReportBase / setReportBase。
//
// 字段说明（依据 wms-report-fetcher Go 工具 + 抓包 HAR 实证）：
//   viewlet     —— 报表模板路径（报表页 URL 的 viewlet 参数）
//   batchParam  —— 批号参数名（POST fr_dialog 的 __parameters__ 键名，原始中文，提交时经 cjkEncode 转 hex）
//   取数接口    —— op=page_content 分页返回 HTML 表格；「桶编码 / 数量」列由 parseTable 按表头解析

const config = {
    // 报表 servlet 基地址（出厂默认，可被 storage 覆盖）
    base: 'http://172.16.1.71:8981/webroot/decision/view/report',
    // 报表模板（URL 编码前的原始路径）
    viewlet: 'WMS-Y/唛头打印信息.cpt',
    // 批号参数名（POST __parameters__ 里的键名，原始中文）
    batchParam: '批号'
}

export default config

// ---------- 报表地址运行时可覆盖 ----------
export const FR_BASE_KEY = 'fr_base_override'

// 生效的报表地址：storage 覆盖值（合法 http(s) URL）优先，否则用 config.base
export function getReportBase() {
    try {
        const o = uni.getStorageSync(FR_BASE_KEY)
        if (o && typeof o === 'string' && /^https?:\/\//.test(o)) return o.replace(/\/+$/, '')
    } catch (e) { /* storage 不可用时回退默认值 */ }
    return config.base
}

// 设置 / 清除覆盖值；传空则恢复默认。返回最终生效值。
export function setReportBase(url) {
    const s = String(url || '').trim().replace(/\/+$/, '')
    if (!s) {
        try { uni.removeStorageSync(FR_BASE_KEY) } catch (e) {}
        return config.base
    }
    if (!/^https?:\/\//.test(s)) throw new Error('地址需以 http:// 或 https:// 开头')
    try { uni.setStorageSync(FR_BASE_KEY, s) } catch (e) {}
    return s
}
