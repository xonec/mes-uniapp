'use strict'

const { batchIsValid } = require('mes-common')

// 云函数端：包装指令单 OCR 文本 → 表头标量字段（纯正则，无需大模型）。
// 与客户端 utils/order-parser.js 保持逻辑一致（两端不能共享文件，改一端请同步另一端）。
// 物料清单由调用方用 productCode 反查 product_materials 档案（enrichFromArchive），不在此 OCR。

const FIELD_LABELS = {
    orderNo: ['订单号', '订单编号', '订单'],
    batchNo: ['生产批号', '产品批号', '生产批', '批号', '批 号'],
    productCode: ['产品编码', '产品代码', '货号', '货 号'],
    productName: ['产品名称', '产品名', '品名', '品 名'],
    packSpec: ['包装规格', '包装', '规格'],
    plannedQty: ['计划产量', '计划数量', '生产数量', '生产计划', '产量'],
    sampleCount: ['取样数量', '取样数', '取样']
}

const FIELD_NAME = {
    orderNo: '订单号',
    batchNo: '批号',
    productCode: '产品编码',
    productName: '产品名称',
    packSpec: '包装规格',
    plannedQty: '计划产量',
    sampleCount: '取样数'
}

function cleanBatch(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanDigits(s) {
    return String(s == null ? '' : s).replace(/[^0-9]/g, '')
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function labelsAlt(labels) {
    return labels.map(escapeRe).join('|')
}

function extractLabeled(text, labels, valueRe) {
    const re = new RegExp('(?:' + labelsAlt(labels) + ')\\s*[:：=-]?\\s*(' + valueRe + ')')
    const m = text.match(re)
    return m ? m[1] : ''
}

function scanBatch(text) {
    const tokens = cleanBatch(text).match(/[A-Z0-9]+/g) || []
    return tokens.find(token => batchIsValid(token)) || ''
}

function scanProductCode(text) {
    var tokens = String(text).split(/[^0-9]+/).filter(Boolean)
    for (var i = 0; i < tokens.length; i++) {
        if (/^\d{10}$/.test(tokens[i])) return tokens[i]
    }
    return ''
}

function extractSampleCount(text) {
    const re = /取样(?:数量|数)?[^0-9\n]{0,8}(\d+)/g
    let sum = 0
    let hit = false
    let m
    while ((m = re.exec(text)) !== null) {
        sum += Number(m[1])
        hit = true
    }
    return hit ? String(sum) : ''
}

function parseOrderSheet(text, opts) {
    opts = opts || {}
    const t = String(text == null ? '' : text).replace(/\r/g, '')
    const flagMissing = opts.flagMissing !== false
    const uncertain = []
    const warnings = []

    const orderNo = cleanDigits(extractLabeled(t, FIELD_LABELS.orderNo, '\\d{4,12}'))
    if (flagMissing && !orderNo) uncertain.push('orderNo')

    const batchRaw = extractLabeled(t, FIELD_LABELS.batchNo, '[A-Za-z0-9]{6,20}')
    let batchNo = batchRaw ? cleanBatch(batchRaw) : ''
    if (!batchNo) batchNo = scanBatch(t)
    if (batchNo && !batchIsValid(batchNo)) uncertain.push('batchNo')
    else if (flagMissing && !batchNo) uncertain.push('batchNo')

    let productCode = cleanDigits(extractLabeled(t, FIELD_LABELS.productCode, '\\d{10}'))
    if (!productCode) productCode = scanProductCode(t)
    if (productCode && !/^\d{10}$/.test(productCode)) uncertain.push('productCode')
    else if (flagMissing && !productCode) {
        uncertain.push('productCode')
        warnings.push('未识别到产品编码，无法反查物料档案')
    }

    const productName = extractLabeled(t, FIELD_LABELS.productName, '[^\\n]{2,40}').trim()

    let packSpec = extractLabeled(t, FIELD_LABELS.packSpec, '\\d+\\s*[瓶罐袋条盒包支听]\\s*/?\\s*\\d*\\s*[箱盒包件]?')
    if (!packSpec) packSpec = extractLabeled(t, FIELD_LABELS.packSpec, '[^\\n]{1,20}').trim()
    if (packSpec) packSpec = packSpec.replace(/\s+/g, '')

    const plannedRaw = extractLabeled(t, FIELD_LABELS.plannedQty, '\\d{1,8}')
    let plannedQty = ''
    if (plannedRaw) {
        const n = Number(plannedRaw)
        plannedQty = Number.isFinite(n) ? n : ''
        if (!plannedQty) uncertain.push('plannedQty')
    } else if (flagMissing) {
        uncertain.push('plannedQty')
    }

    const sampleCount = extractSampleCount(t)

    return {
        orderNo: orderNo,
        batchNo: batchNo,
        productCode: productCode,
        productName: productName,
        packSpec: packSpec,
        plannedQty: plannedQty,
        sampleCount: sampleCount,
        materials: [],
        uncertain: uncertain.filter(function (_, i) { return uncertain.indexOf(uncertain[i]) === i }),
        warnings: warnings,
        parser: 'regex'
    }
}

function normalizeMaterialCode(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '')
}

function buildMaterialsFromArchive(doc) {
    if (!doc || !Array.isArray(doc.materials)) return []
    return doc.materials
        .map(function (m, i) {
            m = m || {}
            return {
                seq: Number.isFinite(Number(m.seq)) ? Number(m.seq) : i + 1,
                materialCode: normalizeMaterialCode(m.materialCode),
                materialName: String(m.materialName || ''),
                spec: String(m.spec || ''),
                materialVersion: String(m.materialVersion || '') || 'N/A',
                unit: String(m.unit || '')
            }
        })
        .filter(function (m) { return m.materialCode })
}

function enrichFromArchive(parsed, doc) {
    const out = Object.assign({}, parsed, { materials: parsed.materials || [] })
    if (doc && Array.isArray(doc.materials) && doc.materials.length) {
        out.materials = buildMaterialsFromArchive(doc)
        out.materialsSource = 'archive'
    } else {
        out.materialsSource = 'none'
    }
    if (!String(out.productName || '').trim() && doc && doc.productName) out.productName = String(doc.productName)
    if (!String(out.packSpec || '').trim() && doc && doc.packSpec) out.packSpec = String(doc.packSpec)
    return out
}

module.exports = {
    parseOrderSheet: parseOrderSheet,
    buildMaterialsFromArchive: buildMaterialsFromArchive,
    enrichFromArchive: enrichFromArchive,
    batchIsValid: batchIsValid,
    cleanBatch: cleanBatch,
    cleanDigits: cleanDigits,
    FIELD_NAME: FIELD_NAME
}
