// 安卓端：从帆软 FineReport 获取某批号的「每桶件数」
// 原理（来自对 HAR 的解析）：
//   1. 隐藏 webview 打开报表页（带批号参数，自动走企业 SSO）
//   2. SSO 多重重定向稳定后（URL 3 秒不变）注入 JS
//   3. 注入 JS 从报表页 HTML 提取 sessionID，fetch 导出接口(extype=simple) 拿到 xlsx
//   4. xlsx 转 base64 写入 plus.storage，主线程轮询取出
//   5. SheetJS 解析，按桶号 A-J 分组汇总每桶件数
//
// 仅 APP-PLUS (安卓) 可用；微信小程序端走不到 webview，调用会 reject。

import config from './fr-config.js'

const STORAGE_B64 = 'fr_excel_b64'
const STORAGE_FLAG = 'fr_excel_flag'

export function isAppAndroid() {
    // #ifdef APP-PLUS
    try { return plus.os.name === 'Android' } catch (e) { return false }
    // #endif
    return false
}

function buildReportUrl(batchNo) {
    return `${config.base}?viewlet=${encodeURIComponent(config.viewlet)}&op=${config.op}&${encodeURIComponent(config.batchParam)}=${encodeURIComponent(batchNo)}`
}

// 注入到隐藏 webview 中执行的函数（会被 toString 后注入）
function webviewFetch() {
    try {
        var href = location.href
        var html = ''
        try { html = document.documentElement.outerHTML || '' } catch (e) {}
        var RE = /sessionID["']?\s*[:=]\s*["']?([0-9a-fA-F-]{36})/
        var m = html.match(RE)
        // 顶层文档没有 -> 遍历 iframe（帆软部分版本用 frameset 渲染）
        if (!m) {
            var ifr = document.getElementsByTagName('iframe')
            for (var i = 0; i < ifr.length && !m; i++) {
                try {
                    var d = ifr[i].contentDocument
                    if (d && d.documentElement) m = (d.documentElement.outerHTML || '').match(RE)
                } catch (e) {}
            }
        }
        // 全局变量（新版帆软常把 sessionID 放在外部 JS，不在 HTML 内联）
        if (!m) {
            try { if (window.sessionID && /^[0-9a-fA-F-]{36}$/.test(window.sessionID)) m = ['', window.sessionID] } catch (e) {}
        }
        // cookie
        if (!m) {
            try { var ck = (document.cookie || '').match(/sessionID=([0-9a-fA-F-]{36})/); if (ck) m = ck } catch (e) {}
        }
        if (!m) {
            var low = (html || '').toLowerCase()
            var hint = '未取到帆软会话(sessionID)'
            if (!html || html.length < 200) hint = '帆软页面为空（可能无法访问内网）'
            else if (low.indexOf('login') >= 0 || low.indexOf('sso') >= 0 || low.indexOf('登录') >= 0) hint = '帆软未登录（SSO 会话缺失）'
            plus.storage.setItem('fr_excel_flag', 'ERR:' + hint + ' @' + href.slice(0, 140))
            return
        }
        var sid = m[1]
        var url = 'REPORTBASE?op=export&sessionID=' + sid + '&format=excel&extype=EXTYPE'
        fetch(url, { credentials: 'include' }).then(function (r) { return r.arrayBuffer() }).then(function (buf) {
            var bytes = new Uint8Array(buf)
            var bin = '', chunk = 0x8000
            for (var i = 0; i < bytes.length; i += chunk) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
            }
            plus.storage.setItem('fr_excel_b64', btoa(bin))
            plus.storage.setItem('fr_excel_flag', 'DONE')
        }).catch(function (e) { plus.storage.setItem('fr_excel_flag', 'ERR:' + (e && e.message || e)) })
    } catch (e) { plus.storage.setItem('fr_excel_flag', 'ERR:' + (e && e.message || e)) }
}

function wrapInject() {
    let src = '(' + webviewFetch.toString() + ')();'
    src = src.replace('REPORTBASE', config.base).replace('EXTYPE', config.extype)
    return src
}

function pickCol(cols, hints) {
    for (const h of hints) {
        const exact = cols.find(k => k === h)
        if (exact) return exact
    }
    for (const h of hints) {
        const c = cols.find(k => k && k.toLowerCase().indexOf(h.toLowerCase()) >= 0)
        if (c) return c
    }
    return null
}

function findBucketCol(rows) {
    const cols = Object.keys(rows[0])
    for (const c of cols) {
        let hit = 0, total = 0
        for (const r of rows) {
            const v = String(r[c] || '').trim()
            if (!v) continue
            total++
            if (/^[A-Ja-j]$/.test(v)) hit++
        }
        if (total > 0 && hit / total >= 0.7) return c
    }
    return null
}

function findNumCol(rows, exclude) {
    const cols = Object.keys(rows[0]).filter(c => c !== exclude)
    for (const c of cols) {
        let hit = 0, total = 0
        for (const r of rows) {
            const v = String(r[c] || '').trim()
            if (v === '') continue
            total++
            if (/^\d+(\.\d+)?$/.test(v)) hit++
        }
        if (total > 0 && hit / total >= 0.8) return c
    }
    return null
}

async function parseBuckets(b64) {
    // 按需加载 xlsx，避免在微信 / H5 等非安卓环境执行而触发告警
    const mod = await import('../libs/xlsx.full.min.js')
    const XLSX = (mod && mod.default) ? mod.default : mod
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
    if (!rows.length) throw new Error('报表无数据行')

    const cols = Object.keys(rows[0])
    const bucketCol = pickCol(cols, config.bucketColHint) || findBucketCol(rows)
    const qtyCol = pickCol(cols, config.qtyColHint) || findNumCol(rows, bucketCol)
    if (!bucketCol) throw new Error('未找到桶号列（请检查 fr-config 的 bucketColHint）')
    if (!qtyCol) throw new Error('未找到件数列（请检查 fr-config 的 qtyColHint）')

    const result = {}
    for (let i = 0; i < 10; i++) result[String.fromCharCode(65 + i)] = 0
    rows.forEach(r => {
        let b = String(r[bucketCol] || '').trim().toUpperCase()
        if (!/^[A-J]$/.test(b)) return
        const q = Number(String(r[qtyCol]).replace(/[^\d.]/g, '')) || 0
        result[b] = (result[b] || 0) + q
    })
    return result
}

// ---- JSON 模式：复用 SSO webview，但改为请求帆软 JSON 输出，去掉 xlsx / SheetJS ----
const STORAGE_JSON = 'fr_json_text'
const STORAGE_JSON_FLAG = 'fr_json_flag'

// 注入隐藏 webview 执行：把当前报表页 URL 的 op 改成 JSON 输出并 fetch
function webviewFetchJson() {
    try {
        var href = location.href
        try { plus.storage.setItem('fr_json_url', href.slice(0, 200)) } catch (e) {}
        var url = href.replace(/([?&]op=)[^&]*/, '$1fr_json')
        if (url.indexOf('op=') < 0) url += (url.indexOf('?') < 0 ? '?' : '&') + 'op=fr_json'
        fetch(url, { credentials: 'include' }).then(function (r) { return r.text() }).then(function (t) {
            plus.storage.setItem('fr_json_text', t)
            plus.storage.setItem('fr_json_flag', 'DONE')
        }).catch(function (e) { plus.storage.setItem('fr_json_flag', 'ERR:' + (e && e.message || e)) })
    } catch (e) { plus.storage.setItem('fr_json_flag', 'ERR:' + (e && e.message || e)) }
}

function wrapInjectJson() {
    return '(' + webviewFetchJson.toString() + ')();'
}

function parseBucketsJson(text) {
    let data
    try { data = JSON.parse(text) } catch (e) { throw new Error('JSON 解析失败（返回内容非 JSON）') }
    let rows
    if (Array.isArray(data)) rows = data
    else if (data && Array.isArray(data.rows)) rows = data.rows
    else if (data && Array.isArray(data.data)) rows = data.data
    else if (data && data.Result && Array.isArray(data.Result)) rows = data.Result
    else throw new Error('JSON 结构无法识别（需为行对象数组）')
    if (!rows.length) throw new Error('报表无数据行')

    const cols = Object.keys(rows[0])
    const bucketCol = pickCol(cols, config.bucketColHint) || findBucketCol(rows)
    const qtyCol = pickCol(cols, config.qtyColHint) || findNumCol(rows, bucketCol)
    if (!bucketCol) throw new Error('未找到桶号列（请检查 fr-config 的 bucketColHint）')
    if (!qtyCol) throw new Error('未找到件数列（请检查 fr-config 的 qtyColHint）')

    const result = {}
    for (let i = 0; i < 10; i++) result[String.fromCharCode(65 + i)] = 0
    rows.forEach(r => {
        let b = String(r[bucketCol] || '').trim().toUpperCase()
        if (!/^[A-J]$/.test(b)) return
        const q = Number(String(r[qtyCol]).replace(/[^\d.]/g, '')) || 0
        result[b] = (result[b] || 0) + q
    })
    return result
}

function fetchBatchBucketQtysJson(batchNo) {
    return new Promise((resolve, reject) => {
        let wv, pollTimer, watchTimer, lastChange = Date.now(), injected = false, settled = false
        const cleanup = () => {
            try { wv && wv.close() } catch (e) {}
            clearInterval(pollTimer); clearInterval(watchTimer)
            try { plus.storage.removeItem(STORAGE_JSON); plus.storage.removeItem(STORAGE_JSON_FLAG) } catch (e) {}
        }
        const done = (v) => { if (settled) return; settled = true; cleanup(); resolve(v) }
        const fail = (m) => { if (settled) return; settled = true; cleanup(); reject(new Error(m)) }

        try { plus.storage.removeItem(STORAGE_JSON); plus.storage.removeItem(STORAGE_JSON_FLAG) } catch (e) {}
        const url = buildReportUrl(batchNo)
        wv = plus.webview.create(url, 'fr_json_' + Date.now(), {
            top: '100%', left: '0px', width: '100%', height: '100%',
            popGesture: 'none', bounce: 'none', audio: 'none'
        })
        wv.addEventListener('loaded', () => { lastChange = Date.now() })
        wv.show()

        watchTimer = setInterval(() => {
            if (injected) return
            const u = wv.getURL ? wv.getURL() : ''
            const onReport = /view\/report/.test(u) && !/login|sso|cas|auth|oauth/i.test(u)
            if (onReport && Date.now() - lastChange > 3000) {
                injected = true
                try { wv.evalJS(wrapInjectJson()) } catch (e) { fail('注入脚本失败: ' + e.message) }
            }
            if (Date.now() - lastChange > 30000) fail('报表加载超时（可能未登录 SSO，请先在系统浏览器登录）')
        }, 500)

        pollTimer = setInterval(() => {
            let f
            try { f = plus.storage.getItem(STORAGE_JSON_FLAG) } catch (e) { return }
            if (!f) return
            if (f === 'DONE') {
                let t
                try { t = plus.storage.getItem(STORAGE_JSON) } catch (e) {}
                if (!t) { fail('JSON 数据为空'); return }
                try {
                    parseBucketsJson(t).then(done).catch(e => fail('解析失败: ' + e.message))
                } catch (e) { fail('解析失败: ' + e.message) }
            } else if (f.indexOf('ERR:') === 0) { fail(f.slice(4)) }
        }, 500)
    })
}

// 原 xlsx 方案（webview 导出 + SheetJS 解析），作为 JSON 失败时的回退
function fetchBatchBucketQtysXlsx(batchNo) {
    return new Promise((resolve, reject) => {
        if (!isAppAndroid()) {
            reject(new Error('当前环境不支持（仅安卓 App 可从帆软获取）'))
            return
        }
        let wv, pollTimer, watchTimer, lastChange = Date.now(), injected = false, settled = false

        const cleanup = () => {
            try { wv && wv.close() } catch (e) {}
            clearInterval(pollTimer); clearInterval(watchTimer)
            try { plus.storage.removeItem(STORAGE_B64); plus.storage.removeItem(STORAGE_FLAG) } catch (e) {}
        }
        const done = (val) => { if (settled) return; settled = true; cleanup(); resolve(val) }
        const fail = (msg) => { if (settled) return; settled = true; cleanup(); reject(new Error(msg)) }

        try { plus.storage.removeItem(STORAGE_B64); plus.storage.removeItem(STORAGE_FLAG) } catch (e) {}

        const url = buildReportUrl(batchNo)
        wv = plus.webview.create(url, 'fr_fetch_' + Date.now(), {
            top: '100%', left: '0px', width: '100%', height: '100%',
            popGesture: 'none', bounce: 'none', audio: 'none'
        })
        wv.addEventListener('loaded', () => { lastChange = Date.now() })
        wv.show()

        // 监听 SSO 重定向稳定
        watchTimer = setInterval(() => {
            if (injected) return
            const u = wv.getURL ? wv.getURL() : ''
            const onReport = /view\/report/.test(u) && !/login|sso|cas|auth|oauth/i.test(u)
            if (onReport && Date.now() - lastChange > 3000) {
                injected = true
                try { wv.evalJS(wrapInject()) } catch (e) { fail('注入脚本失败: ' + e.message) }
            }
            if (Date.now() - lastChange > 30000) fail('报表加载超时（可能未登录 SSO，请先在系统浏览器登录）')
        }, 500)

        // 轮询导出结果
        pollTimer = setInterval(() => {
            let f
            try { f = plus.storage.getItem(STORAGE_FLAG) } catch (e) { return }
            if (!f) return
            if (f === 'DONE') {
                let b64
                try { b64 = plus.storage.getItem(STORAGE_B64) } catch (e) {}
                if (!b64) { fail('导出数据为空'); return }
                try {
                    parseBuckets(b64).then(done).catch(e => fail('解析失败: ' + e.message))
                } catch (e) { fail('解析失败: ' + e.message) }
            } else if (f.indexOf('ERR:') === 0) {
                fail(f.slice(4))
            }
        }, 500)
    })
}

// 主入口：返回 {A:n, B:n, ...} 每桶件数
// jsonMode 开启时优先走 JSON（去掉 SheetJS / xlsx），失败自动回退 xlsx
export function fetchBatchBucketQtys(batchNo) {
    if (!isAppAndroid()) {
        return Promise.reject(new Error('当前环境不支持（仅安卓 App 可从帆软获取）'))
    }
    if (config.jsonMode) {
        return fetchBatchBucketQtysJson(batchNo).catch(err => {
            console.warn('[fr-fetch] JSON 获取失败，回退 xlsx：', err && err.message)
            return fetchBatchBucketQtysXlsx(batchNo)
        })
    }
    return fetchBatchBucketQtysXlsx(batchNo)
}
