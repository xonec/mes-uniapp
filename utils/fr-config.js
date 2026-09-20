// 帆软 FineReport 报表配置（用于安卓端获取批号每桶件数）
//
// base 只是「出厂默认值」：运行时优先读管理员在「用户管理」页设置的覆盖值（本地 storage），
// 换服务器 / 换 IP 时无需改代码重新打包。见文件末尾的 getReportBase / setReportBase。

const config = {
    // 报表 servlet 基地址（出厂默认，可被 storage 覆盖）
    base: 'http://172.16.1.71:8981/webroot/decision/view/report',
    // 报表模板（URL 编码前的原始路径）
    viewlet: 'WMS-Y/宜宾头部打印信息.cpt',
    // 批号参数名（报表参数）
    batchParam: '批号',
    // 打开报表用的 op
    op: 'write',
    // 导出类型：simple = 原样导出（列最全）
    extype: 'simple',
    // 列名提示：解析 xlsx / JSON 时用于推断「桶号列」与「件数列」
    // 可按实际报表表头调整（报表实际列为「桶编码」/「数量」/「数量单位」）
    bucketColHint: ['桶编码', '桶号', '桶', '桶位', 'bucket'],
    qtyColHint: ['件数', '箱数', '数量', '支数', '瓶数', 'qty', 'count'],

    // ===== JSON 模式（去 Excel / SheetJS）=====
    // true 时优先走帆软 JSON 输出（op=fr_json），失败自动回退 xlsx。
    // 帆软 .cpt 支持在 URL 把 op 改成 fr_json 直接返回报表数据（行对象 JSON）。
    // 安卓真机在公司 WiFi 直连内网帆软时启用，设备端不再加载 SheetJS / 解析 xlsx。
    jsonMode: true,
    // 若帆软版本不同，op 名按实际调整（常见为 fr_json）。该值会被注入到 webview 脚本中真正生效。
    jsonOp: 'fr_json'
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
