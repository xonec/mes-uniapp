// 帆软 FineReport「唛头打印信息」取数 —— uni.request 三步法（App / 微信小程序 / H5 通用）
// 取数三步（与 wms-report-fetcher Go 工具 / 抓包 HAR 一致）：
//   1. GET  viewlet 报表页 → 从 HTML 提取 sessionID（FR.SessionMgr.register）
//   2. POST op=fr_dialog&cmd=parameters_d 提交批号（header 带 sessionID，body 经 cjkEncode）
//   3. GET  op=page_content 分页 → 解析 <table>，按「桶编码」统计各桶记录条数 {A..J}
//
// 要点：
//   - 报表为匿名访问（无登录态），sessionID 来自第一步响应，无需企业 SSO 登录，故不依赖 webview/plus。
//   - cjkEncode 复刻帆软前端：非 ASCII(>=128) 及 '[' ']' 转成 [十六进制]。
//   - 小程序 request 合法域名需 HTTPS + 备案（开发期可勾「不校验合法域名」），且手机须与服务器同局域网。
//   - 本场景无需 Cookie / Authorization，故不手动设置（小程序禁设 Cookie 请求头）。

import config, { getReportBase } from './fr-config.js'

// 复刻帆软前端 FR.cjkEncode：非 ASCII(>=128) 及 '[' ']' 转成 [十六进制]
export function cjkEncode(text) {
    let out = ''
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code >= 128 || code === 91 || code === 93) {
            out += '[' + code.toString(16) + ']'
        } else {
            out += text.charAt(i)
        }
    }
    return out
}

// HTML 实体解码（数据单元格基本是纯文本，兜底处理常见实体）
export function decodeEntities(s) {
    return s
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
}

// 桌面浏览器 UA：帆软按 UA 区分桌面/移动端，移动端页面不含 FR.SessionMgr.register，
// 必须伪装成桌面浏览器才能拿到含 sessionID 的桌面版 HTML（安卓 App 默认 UA 会被当成移动端）。
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0'

// 统一请求封装（Promise 化 uni.request）
function request(options) {
    return new Promise((resolve, reject) => {
        uni.request({
            ...options,
            header: {
                'User-Agent': DESKTOP_UA,
                ...(options.header || {})
            },
            success: (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(res)
                else reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`))
            },
            fail: (err) => reject(new Error(err.errMsg || '网络请求失败'))
        })
    })
}

// 1. 取 sessionID（dataType:'text' 拿原始 HTML，防止被当 JSON 解析失败）
async function fetchSessionID(base, viewlet) {
    const url = `${base}?viewlet=${encodeURIComponent(viewlet)}`
    const res = await request({ url, method: 'GET', dataType: 'text' })
    const m = res.data.match(/FR\.SessionMgr\.register\('([^']+)'/)
    if (!m) {
        // 带上诊断信息：状态码 + 响应开头片段，便于判断服务器实际返回了什么
        // （典型情况：手机不在服务器所在内网 → 运营商拦截页；帆软跳登录页；或返回了移动版页面）
        const head = String(res.data || '').replace(/\s+/g, ' ').slice(0, 160)
        throw new Error(`响应中未找到 sessionID（HTTP ${res.statusCode}）响应开头：${head || '（空）'}`)
    }
    return m[1]
}

// 2. 提交批号参数。参数 JSON：{"LABEL<参数>":"<参数>:","<参数>":"<值>"}
async function submitParam(base, sessionID, param, value) {
    const json = `{"LABEL${param}":"${param}:","${param}":"${value}"}`
    const body = `__parameters__=${encodeURIComponent(cjkEncode(json))}`
    return request({
        url: `${base}?op=fr_dialog&cmd=parameters_d`,
        method: 'POST',
        header: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', sessionID },
        data: body
    })
}

// 3. 拉第 pn 页渲染内容
async function fetchPage(base, sessionID, pn) {
    const q = ['op=page_content', `pn=${pn}`, '__boxModel__=true', '__webpage__=true', '__fit__=false', '_paperWidth=803', '_paperHeight=522', `_=${Date.now()}`].join('&')
    const res = await request({ url: `${base}?${q}`, method: 'GET', header: { sessionID } })
    const html = (res.data && res.data.html) || ''
    const m = html.match(/reportTotalPage=(\d+)/)
    return { html, totalPage: m ? parseInt(m[1], 10) : 1 }
}

// 解析 <table> 数据行（跳过标题行与表头行，每行 6 列）
export function parseTable(htmlStr) {
    const rows = []
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g
    let tr
    while ((tr = trRe.exec(htmlStr)) !== null) {
        const cells = []
        let td
        while ((td = tdRe.exec(tr[1])) !== null) {
            cells.push(decodeEntities(td[1].trim()))
        }
        if (cells.length === 6 && cells[0] !== '序号') {
            rows.push(cells)
        }
    }
    return rows
}

// 主入口：按批号取数 → 对象数组 [{序号,批号,桶编码,数量,数量单位,操作人}]
async function fetchReport({ batch, base, viewlet, param }) {
    if (!batch) throw new Error('batch 不能为空')
    const sessionID = await fetchSessionID(base, viewlet)
    await submitParam(base, sessionID, param, batch)
    const { html, totalPage } = await fetchPage(base, sessionID, 1)
    const rows = parseTable(html)
    const seen = new Set(rows.map(r => r.join('\u0000')))
    for (let pn = 2; pn <= totalPage; pn++) {
        const { html: h } = await fetchPage(base, sessionID, pn)
        let added = false
        for (const r of parseTable(h)) {
            const k = r.join('\u0000')
            if (!seen.has(k)) { seen.add(k); rows.push(r); added = true }
        }
        if (!added) break
    }
    return rows.map(r => ({ 序号: r[0], 批号: r[1], 桶编码: r[2], 数量: r[3], 数量单位: r[4], 操作人: r[5] }))
}

// 纯函数：把取数行按「桶编码」统计成 {A:n, B:n, ..., J:n}（桶编码取 A-J，其余忽略，不区分大小写）
export function summarizeBucketCounts(rows) {
    const result = {}
    for (let i = 0; i < 10; i++) result[String.fromCharCode(65 + i)] = 0
    rows.forEach(r => {
        const b = String((r && r.桶编码) || '').trim().toUpperCase()
        if (/^[A-J]$/.test(b)) result[b] = (result[b] || 0) + 1
    })
    return result
}

// 是否安卓（供 materials.vue 判断「从帆软获取」按钮显示；取数本身已不限于安卓）
export function isAppAndroid() {
    // #ifdef APP-PLUS
    try { return plus.os.name === 'Android' } catch (e) { return false }
    // #endif
    return false
}

// 适配 mes-uniapp 接口：按批号取数，统计各桶编码（A-J）的记录条数 → {A:n, B:n, ..., J:n}
export async function fetchBatchBucketQtys(batchNo) {
    const rows = await fetchReport({
        batch: batchNo,
        base: getReportBase(),
        viewlet: config.viewlet,
        param: config.batchParam
    })
    return summarizeBucketCounts(rows)
}
