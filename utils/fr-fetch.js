// 安卓端：从帆软 FineReport 获取某批号的「每桶件数」
// 原理（来自对 HAR 的解析）：
//   1. 隐藏 webview 打开报表页（带批号参数，自动走企业 SSO）
//   2. SSO 多重重定向稳定后（URL 3 秒不变）注入 JS
//   3. 注入 JS 从报表页取会话，fetch 导出/JSON 接口拿到数据
//   4. 数据写入 plus.storage，主线程轮询取出
//   5. 解析并按桶号 A-J 分组汇总每桶件数
//
// 两条取数通道共用同一套「webview → 注入 → 轮询 → 解析」脚手架（runWebviewFetch）：
//   - JSON 模式（首选）：op=fr_json 直接拿行对象 JSON，不加载 SheetJS
//   - xlsx 模式（回退）：op=export 导出表格，用 SheetJS 解析
//
// 仅 APP-PLUS (安卓) 可用；微信小程序端走不到 webview，调用会 reject。

import config, { getReportBase } from './fr-config.js'

const STORAGE_B64 = 'fr_excel_b64'
const STORAGE_FLAG = 'fr_excel_flag'
const STORAGE_JSON = 'fr_json_text'
const STORAGE_JSON_FLAG = 'fr_json_flag'

export function isAppAndroid() {
    // #ifdef APP-PLUS
    try { return plus.os.name === 'Android' } catch (e) { return false }
    // #endif
    return false
}

function buildReportUrl(batchNo) {
    return `${getReportBase()}?viewlet=${encodeURIComponent(config.viewlet)}&op=${config.op}&${encodeURIComponent(config.batchParam)}=${encodeURIComponent(batchNo)}`
}

// ============ 注入到隐藏 webview 中执行的函数（会被 toString 后注入） ============
// 其中 __BASE__ / __EXTYPE__ / __JSONOP__ 为占位符，注入前由配置替换。

function webviewFetchXlsx() {
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
        var url = '__BASE__?op=export&sessionID=' + sid + '&format=excel&extype=__EXTYPE__'
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

// JSON 通道：复用当前报表页 URL，把 op 改成 fr_json 再 fetch
function webviewFetchJson() {
    try {
        var href = location.href
        try { plus.storage.setItem('fr_json_url', href.slice(0, 200)) } catch (e) {}
        var url = href.replace(/([?&]op=)[^&]*/, '$1__JSONOP__')
        if (url.indexOf('op=') < 0) url += (url.indexOf('?') < 0 ? '?' : '&') + 'op=__JSONOP__'
        fetch(url, { credentials: 'include' }).then(function (r) { return r.text() }).then(function (t) {
            plus.storage.setItem('fr_json_text', t)
            plus.storage.setItem('fr_json_flag', 'DONE')
        }).catch(function (e) { plus.storage.setItem('fr_json_flag', 'ERR:' + (e && e.message || e)) })
    } catch (e) { plus.storage.setItem('fr_json_flag', 'ERR:' + (e && e.message || e)) }
}

// 只允许安全字符，避免注入到被求值的 JS 串里破坏语法
function safeToken(v, fallback) {
    const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_\-.:/]/g, '')
    return s || fallback
}

function buildInject(injectFn, tokens) {
    let src = '(' + injectFn.toString() + ')();'
    Object.keys(tokens).forEach(k => {
        src = src.split(k).join(tokens[k])
    })
    return src
}

function buildXlsxInject() {
    return buildInject(webviewFetchXlsx, {
        __BASE__: safeToken(getReportBase(), ''),
        __EXTYPE__: safeToken(config.extype, 'simple')
    })
}

function buildJsonInject() {
    return buildInject(webviewFetchJson, {
        __JSONOP__: safeToken(config.jsonOp, 'fr_json')
    })
}

// ============ 解析：xlsx / JSON 两条通道共用「列识别 + 按桶汇总」 ============

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

// 行对象数组 → {A:n, B:n, ..., J:n}
function aggregateByBucket(rows) {
    if (!rows.length) throw new Error('报表无数据行')
    const cols = Object.keys(rows[0])
    const bucketCol = pickCol(cols, config.bucketColHint) || findBucketCol(rows)
    const qtyCol = pickCol(cols, config.qtyColHint) || findNumCol(rows, bucketCol)
    if (!bucketCol) throw new Error('未找到桶号列（请检查 fr-config 的 bucketColHint）')
    if (!qtyCol) throw new Error('未找到件数列（请检查 fr-config 的 qtyColHint）')

    const result = {}
    for (let i = 0; i < 10; i++) result[String.fromCharCode(65 + i)] = 0
    rows.forEach(r => {
        const b = String(r[bucketCol] || '').trim().toUpperCase()
        if (!/^[A-J]$/.test(b)) return
        const q = Number(String(r[qtyCol]).replace(/[^\d.]/g, '')) || 0
        result[b] = (result[b] || 0) + q
    })
    return result
}

async function parseBuckets(b64) {
    // 按需加载 xlsx，避免在微信 / H5 等非安卓环境执行而触发告警
    const mod = await import('../libs/xlsx.full.min.js')
    const XLSX = (mod && mod.default) ? mod.default : mod
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
    return aggregateByBucket(rows)
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
    return aggregateByBucket(rows)
}

// ============ 通用脚手架：隐藏 webview → 注入 → 轮询 → 解析 ============

function runWebviewFetch(opts) {
    const { url, wvid, injectSrc, storageKey, storageFlag, emptyMsg, onDone } = opts
    return new Promise((resolve, reject) => {
        let wv, pollTimer, watchTimer
        let lastChange = Date.now(), injected = false, settled = false

        const cleanup = () => {
            try { wv && wv.close() } catch (e) {}
            clearInterval(pollTimer); clearInterval(watchTimer)
            try { plus.storage.removeItem(storageKey); plus.storage.removeItem(storageFlag) } catch (e) {}
        }
        const done = (v) => { if (settled) return; settled = true; cleanup(); resolve(v) }
        const fail = (m) => { if (settled) return; settled = true; cleanup(); reject(new Error(m)) }

        try { plus.storage.removeItem(storageKey); plus.storage.removeItem(storageFlag) } catch (e) {}

        wv = plus.webview.create(url, wvid, {
            top: '100%', left: '0px', width: '100%', height: '100%',
            popGesture: 'none', bounce: 'none', audio: 'none'
        })
        wv.addEventListener('loaded', () => { lastChange = Date.now() })
        wv.show()

        // 等 SSO 重定向稳定后再注入（URL 3 秒不变）
        watchTimer = setInterval(() => {
            if (injected) return
            const u = wv.getURL ? wv.getURL() : ''
            const onReport = /view\/report/.test(u) && !/login|sso|cas|auth|oauth/i.test(u)
            if (onReport && Date.now() - lastChange > 3000) {
                injected = true
                try { wv.evalJS(injectSrc) } catch (e) { fail('注入脚本失败: ' + e.message) }
            }
            if (Date.now() - lastChange > 30000) fail('报表加载超时（可能未登录 SSO，请先在系统浏览器登录）')
        }, 500)

        // 轮询注入脚本写入 plus.storage 的结果
        pollTimer = setInterval(() => {
            let f
            try { f = plus.storage.getItem(storageFlag) } catch (e) { return }
            if (!f) return
            if (f === 'DONE') {
                let raw
                try { raw = plus.storage.getItem(storageKey) } catch (e) {}
                if (!raw) { fail(emptyMsg || '数据为空'); return }
                Promise.resolve()
                    .then(() => onDone(raw))
                    .then(done)
                    .catch(e => fail('解析失败: ' + (e && e.message || e)))
            } else if (f.indexOf('ERR:') === 0) {
                fail(f.slice(4))
            }
        }, 500)
    })
}

function fetchBatchBucketQtysXlsx(batchNo) {
    if (!isAppAndroid()) {
        return Promise.reject(new Error('当前环境不支持（仅安卓 App 可从帆软获取）'))
    }
    return runWebviewFetch({
        url: buildReportUrl(batchNo),
        wvid: 'fr_xlsx_' + Date.now(),
        injectSrc: buildXlsxInject(),
        storageKey: STORAGE_B64,
        storageFlag: STORAGE_FLAG,
        emptyMsg: '导出数据为空',
        onDone: parseBuckets
    })
}

function fetchBatchBucketQtysJson(batchNo) {
    if (!isAppAndroid()) {
        return Promise.reject(new Error('当前环境不支持（仅安卓 App 可从帆软获取）'))
    }
    return runWebviewFetch({
        url: buildReportUrl(batchNo),
        wvid: 'fr_json_' + Date.now(),
        injectSrc: buildJsonInject(),
        storageKey: STORAGE_JSON,
        storageFlag: STORAGE_JSON_FLAG,
        emptyMsg: 'JSON 数据为空',
        onDone: parseBucketsJson
    })
}

// 主入口：返回 {A:n, B:n, ...} 每桶件数
// jsonMode 开启时优先走 JSON（不加载 SheetJS），失败自动回退 xlsx
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
