// 帆软 FineReport 报表配置（用于安卓端获取批号每桶件数）
// 与 batch-reader 工具共用同一服务器。正式接入时改为后台下发或设置页可编辑。

export default {
    // 报表 servlet 基地址
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
    // 若帆软版本不同，op 名按实际调整（常见为 fr_json）
    jsonOp: 'fr_json'
}
