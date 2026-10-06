'use strict'
const { ClientError } = require('mes-common')
const { parseOrderSheet } = require('order-parser')
const ENDPOINT = 'https://api.ocr.space/parse/image'
const MAX_FILE_BYTES = 1024 * 1024

/** 读取服务端配置中心，不把密钥打入前端或返回给客户端。 */
function configuredKey() {
    if (process.env.OCRSPACE_API_KEY) return process.env.OCRSPACE_API_KEY
    try { return require('uni-config-center')({ pluginId: 'ocr-space' }).config('apiKey') || '' }
    catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error
        return ''
    }
}

function wordsOf(page) {
    const lines = page.TextOverlay && page.TextOverlay.Lines || []
    return lines.flatMap(line => (line.Words || []).map(word => ({
        text: String(word.WordText || '').trim(), x: Number(word.Left), y: Number(word.Top),
        w: Number(word.Width), h: Number(word.Height)
    }))).filter(word => word.text && [word.x, word.y, word.w, word.h].every(Number.isFinite) && word.h > 0)
}
function normalized(text) { return String(text || '').replace(/\s+/g, '') }
function center(word) { return word.x + word.w / 2 }
function findLabel(words, pattern, minY = -Infinity) {
    return words.filter(word => word.y >= minY && pattern.test(normalized(word.text))).sort((a, b) => a.y - b.y)[0] || null
}
function linesOf(words) {
    const groups = []
    for (const word of words.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
        let line = groups.find(group => Math.abs(group.y - word.y) <= Math.max(word.h, group.h) * .55)
        if (!line) { line = { y: word.y, h: word.h, words: [] }; groups.push(line) }
        line.words.push(word); line.h = Math.max(line.h, word.h)
    }
    return groups.sort((a, b) => a.y - b.y).map(line => line.words.sort((a, b) => a.x - b.x).map(word => word.text).join(' ').trim())
}
function textValue(text, label) {
    const match = String(text).match(new RegExp('(?:' + label + ')\\s*[:：]?\\s*([^\\n|]+)'))
    return match ? match[1].replace(/(?:包装规格|产品名称|计划产量|生产批号|订单编号).*$/, '').trim() : ''
}

// 表头是列标题时，读取对应列下面最多两行；不扫描物料编号猜产品编码。
function productHeaders(words, text) {
    const labels = [findLabel(words, /订单编号/), findLabel(words, /产品编码|产品代码/), findLabel(words, /产品名称/), findLabel(words, /包装规格/), findLabel(words, /计划产量/)].filter(Boolean)
    const result = { productCode: '', productName: '', packSpec: '' }
    for (const [field, pattern] of [['productCode', /产品编码|产品代码/], ['productName', /产品名称/], ['packSpec', /包装规格/]]) {
        const label = labels.find(word => pattern.test(normalized(word.text)))
        if (!label) continue
        const peers = labels.filter(word => Math.abs(word.y - label.y) < label.h * 1.8).sort((a, b) => center(a) - center(b))
        const index = peers.indexOf(label)
        const left = index > 0 ? (center(peers[index - 1]) + center(label)) / 2 : label.x - label.w
        const right = index < peers.length - 1 ? (center(label) + center(peers[index + 1])) / 2 : label.x + label.w * 2.5
        const candidates = words.filter(word => center(word) > left && center(word) < right && word.y > label.y + label.h * .75 && word.y < label.y + label.h * 6)
        result[field] = linesOf(candidates).slice(0, field === 'productCode' ? 1 : 2).join('')
    }
    const explicitCode = textValue(text, '产品编码|产品代码|货号').match(/^\d{10}(?!\d)/)
    if (!/^\d{10}$/.test(normalized(result.productCode))) result.productCode = explicitCode ? explicitCode[0] : ''
    else result.productCode = normalized(result.productCode)
    if (!result.productName) result.productName = textValue(text, '产品名称|产品名')
    if (!result.packSpec) result.packSpec = textValue(text, '包装规格(?:[（(]件[）)])?')
    return result
}

function materialRows(words) {
    const codeHeader = findLabel(words, /物料编号|物料编码/)
    if (!codeHeader) return []
    const unitHeader = findLabel(words, /计量单|计量单位|单位/, codeHeader.y - codeHeader.h)
    if (!unitHeader) return []
    const versionHeader = findLabel(words, /版本号|版本/, codeHeader.y)
    const codes = words.filter(word => word.y > codeHeader.y + codeHeader.h && Math.abs(center(word) - center(codeHeader)) < codeHeader.w * 1.5 && /^\d{8,12}(?:-\d*)?$/.test(normalized(word.text))).sort((a, b) => a.y - b.y)
    if (!codes.length) return []
    const codeLeft = Math.min(...codes.map(word => word.x))
    const codeRight = Math.max(...codes.map(word => word.x + word.w)) + codes[0].h * .4
    const unitLeft = unitHeader.x - unitHeader.h * .5
    const unitRight = unitHeader.x + unitHeader.w + unitHeader.h
    return codes.map((code, index) => {
        const top = code.y - code.h * .5
        const end = codes[index + 1] ? codes[index + 1].y - codes[index + 1].h * .5 : code.y + Math.max(code.h * 4, index ? code.y - codes[index - 1].y : 0)
        const row = words.filter(word => word.y >= top && word.y < end)
        let materialCode = normalized(code.text)
        const continuation = row.find(word => word !== code && center(word) >= codeLeft && center(word) <= codeRight && word.y >= code.y - code.h * .3 && word.y < code.y + code.h * 2 && (/-$/.test(materialCode) ? /^-?\d{1,3}$/ : /^-\d{1,3}$/).test(normalized(word.text)))
        if (continuation && /-$/.test(materialCode)) materialCode += normalized(continuation.text).replace(/^-/, '')
        else if (continuation) materialCode += normalized(continuation.text)
        const nameWords = row.filter(word => center(word) > codeRight && center(word) < unitLeft && Math.abs(word.y - code.y) < code.h * .9)
        const specWords = row.filter(word => word !== continuation && word !== code && center(word) >= codeLeft && center(word) < (versionHeader ? versionHeader.x - versionHeader.h * .2 : unitLeft) && word.y >= code.y + code.h * .9)
        const unit = row.map(word => center(word) > unitLeft && center(word) < unitRight ? normalized(word.text) : '').find(value => /^(千克|克|只|瓶|罐|卷|张|个|件|箱|袋|米|包|套|kg|g)$/i.test(value)) || ''
        const materialVersion = versionHeader ? row.filter(word => center(word) > versionHeader.x - versionHeader.h * .3 && center(word) < unitLeft && word.y > code.y + code.h * .6).map(word => normalized(word.text)).find(value => /^(N\/?A|\d{1,4})$/i.test(value)) : ''
        return { seq: index + 1, materialCode, materialName: linesOf(nameWords).join(' '), spec: linesOf(specWords).join(' '), materialVersion: materialVersion || null, unit }
    })
}

function markdownTables(text) {
    const result = { productCode: '', productName: '', packSpec: '', materials: [] }
    let header = []
    for (const line of String(text).split(/\r?\n/)) {
        if (!line.includes('|')) { header = []; continue }
        const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(value => value.trim())
        if (cells.every(value => /^[:\s-]*$/.test(value))) continue
        if (cells.some(value => /产品编码|物料编号|物料编码/.test(value))) { header = cells; continue }
        if (!header.length) continue
        const value = pattern => { const index = header.findIndex(cell => pattern.test(cell)); return index < 0 ? '' : String(cells[index] || '').replace(/<br\s*\/?\s*>/gi, '\n') }
        if (header.some(cell => /产品编码/.test(cell))) {
            if (/^\d{10}$/.test(normalized(value(/产品编码/)))) Object.assign(result, { productCode: normalized(value(/产品编码/)), productName: value(/产品名称/).replace(/\n/g, ''), packSpec: value(/包装规格/).replace(/\n/g, '') })
        } else {
            const materialCode = normalized(value(/物料编号|物料编码/))
            if (!/^\d{8,12}(?:-\d+)?$/.test(materialCode)) continue
            const names = value(/物料名称/).split('\n')
            result.materials.push({ seq: result.materials.length + 1, materialCode, materialName: names.shift() || '', spec: value(/规格型号/) || names.join(' '), materialVersion: value(/版本/) || null, unit: value(/计量单位|单位/) })
        }
    }
    return result
}

/** 从免费 OCR 的文字与位置提取模板字段，保留不确定标记供人工核对。 */
function parsePages(pages, purpose) {
    const extracted = pages.map(page => {
        const text = String(page.ParsedText || '')
        const words = wordsOf(page)
        const markdown = markdownTables(text)
        const fields = productHeaders(words, text)
        for (const field of ['productCode', 'productName', 'packSpec']) if (markdown[field]) fields[field] = markdown[field]
        const materials = materialRows(words)
        return { ...parseOrderSheet(text), ...fields, materials: materials.length ? materials : markdown.materials }
    })
    const codes = Array.from(new Set(extracted.map(page => page.productCode).filter(Boolean)))
    const result = { productCode: codes.length === 1 ? codes[0] : '', productName: '', packSpec: '', materials: [], uncertain: ['materials'] }
    for (const field of ['productName', 'packSpec']) result[field] = (extracted.find(page => page[field]) || {})[field] || ''
    const seen = new Set()
    for (const [pageIndex, page] of extracted.entries()) for (const material of page.materials) {
        const key = JSON.stringify([material.materialCode, material.materialName, material.spec, material.materialVersion, material.unit])
        if (!seen.has(key)) { seen.add(key); result.materials.push({ ...material, seq: result.materials.length + 1, sourcePages: [pageIndex + 1] }) }
    }
    if (purpose === 'order') for (const field of ['orderNo', 'batchNo', 'plannedQty', 'sampleCount']) result[field] = (extracted.find(page => page[field] !== '' && page[field] != null) || {})[field] || ''
    return { ...result, detectedProductCodes: codes, recognitionDocument: { raw_text: pages.map((page, index) => '第' + (index + 1) + '页\n' + String(page.ParsedText || '')).join('\n\n'), structured_info: null },
        recognitionProvider: 'OCR.space', recognitionModel: '', warnings: ['免费 OCR 的材料名称、规格及跨行编号请逐行核对。初筛可能仅识别首页，请确认材料完整。'] }
}

/** 逐页调用 OCR.space；初筛找到明确产品编码即停止，不自动重试。 */
async function recognizeFree(images, cfg, purpose, options = {}) {
    if (!cfg.ocrSpaceApiKey) throw new ClientError('OCR.space 未配置 Key，请由管理员在 OCR 配置中填写', 503)
    for (const image of images) {
        if (Buffer.byteLength(image.split(',')[1], 'base64') > MAX_FILE_BYTES) throw new ClientError('免费识别单图上限 1 MB，请压缩图片或裁切后重选', 400)
        if (!/^data:image\/(jpeg|jpg|png|gif);/i.test(image)) throw new ClientError('免费识别请使用 JPG、PNG 或 GIF 照片', 400)
    }
    const started = Date.now(), pages = []
    for (const image of images) {
        const remaining = Math.min((Number(options.budgetMs) || 145000) - (Date.now() - started), options.deadline ? options.deadline - Date.now() : Infinity)
        if (remaining < 1000) throw new ClientError('免费识别耗时较长，请减少照片页数后重试', 503)
        const form = new URLSearchParams({ base64Image: image, language: cfg.ocrSpaceEngine === 1 ? 'chs' : 'auto', OCREngine: String(cfg.ocrSpaceEngine || 2), isOverlayRequired: cfg.ocrSpaceEngine === 3 ? 'false' : 'true', isTable: 'true', detectOrientation: 'true', scale: 'true' }).toString()
        let response
        try { response = await uniCloud.httpclient.request(ENDPOINT, { method: 'POST', dataType: 'json', timeout: Math.min(Number(cfg.timeout) || 35000, remaining), headers: { apikey: cfg.ocrSpaceApiKey, 'Content-Type': 'application/x-www-form-urlencoded' }, data: form }) }
        catch (error) { throw new ClientError('免费 OCR 服务暂时不可用，可稍后重试、重新拍照或手动录入', 503) }
        const data = response.data || {}, status = Number(response.status || response.statusCode)
        if (status === 429) throw new ClientError('OCR.space 免费额度或频率已达上限，请稍后重试或手动录入', 429)
        const parsed = Array.isArray(data.ParsedResults) ? data.ParsedResults : []
        if (status >= 400 || data.IsErroredOnProcessing || Number(data.OCRExitCode) > 2 || !parsed.length || parsed.some(page => Number(page.FileParseExitCode) !== 1)) throw new ClientError('OCR.space 未完整识别本页，可稍后重试、重拍或手动录入', 502)
        pages.push(...parsed)
        if (options.screenOnly) {
            const screened = parsePages(pages, purpose)
            if (/^\d{10}$/.test(screened.productCode) || screened.detectedProductCodes.length > 1) return screened
        }
    }
    return parsePages(pages, purpose)
}

module.exports = { configuredKey, recognizeFree, parsePages }
