// 包装指令单 OCR 文本 → 表头标量字段（纯正则，无需大模型）。
//
// 设计原则（来自「从 0 到 1」录入方案）：
//   1. 表头标量字段（订单号/批号/产品编码/产品名称/包装规格/计划产量/取样数）
//      用正则秒提，不卡大模型，离线可用。
//   2. 物料清单「不在这里 OCR」——表格极易错位，改为用产品编码反查
//      product_materials 档案（见 enrichFromArchive），零错位。
//   3. 大模型只当兜底（云端在关键字段缺失时才调，且失败不影响正则结果）。
//
// ⚠ 与云函数端 cloudfunctions/common/order-parser/index.js 保持逻辑一致：
//   客户端与云函数不能共享文件，改此文件时请同步改那边。

// ---------- 字段标签别名（按「更具体在前」排序，避免短标签误命中长标签） ----------
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

// 批号：11 位，且同时含字母与数字（与 utils/product-data.js 的 batchIsValid 同义，此处自包含）
export const batchIsValid = (v) => /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(v || '')

export function cleanBatch(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function cleanDigits(s) {
    return String(s == null ? '' : s).replace(/[^0-9]/g, '')
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function labelsAlt(labels) {
    return labels.map(escapeRe).join('|')
}

// 找到字段标签，返回其后的取值（按 valueRe 捕获）
function extractLabeled(text, labels, valueRe) {
    const re = new RegExp('(?:' + labelsAlt(labels) + ')\\s*[:：=-]?\\s*(' + valueRe + ')')
    const m = text.match(re)
    return m ? m[1] : ''
}

// 全文本扫描批号（标签提取失败兜底）：在非字母数字分隔出的 token 中找 11 位合法批号
// （按 token 切分，避免跨边界拼出假批号）
function scanBatch(text) {
    const tokens = cleanBatch(text).match(/[A-Z0-9]+/g) || []
    for (const tk of tokens) {
        if (tk.length < 11) continue
        for (let i = 0; i + 11 <= tk.length; i++) {
            const w = tk.slice(i, i + 11)
            if (batchIsValid(w)) return w
        }
    }
    return ''
}

// 全文本扫描 10 位产品编码（标签失败兜底）：按非数字切分成独立 token，避免跨边界拼出假编码
function scanProductCode(text) {
    const tokens = String(text).split(/[^0-9]+/).filter(Boolean)
    for (const tk of tokens) {
        if (/^\d{10}$/.test(tk)) return tk
    }
    return ''
}

// 取样数：汇总所有「取样」行后的数字（单据常拆成 成品/精密/菌检/留样 多行）
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

/**
 * 从指令单 OCR 文本正则提取表头标量字段（纯函数、同步、无副作用）。
 * @param {string} text  OCR 文本（ML Kit / 视觉模型输出）
 * @param {object} [opts]
 * @param {boolean} [opts.flagMissing=true]  缺失字段是否计入 uncertain
 * @returns {{orderNo,batchNo,productCode,productName,packSpec,plannedQty,sampleCount,materials,uncertain,warnings,parser}}
 */
export function parseOrderSheet(text, opts = {}) {
    const t = String(text == null ? '' : text).replace(/\r/g, '')
    const flagMissing = opts.flagMissing !== false
    const uncertain = []
    const warnings = []

    // 订单号：纯数字
    const orderNo = cleanDigits(extractLabeled(t, FIELD_LABELS.orderNo, '\\d{4,12}'))
    if (flagMissing && !orderNo) uncertain.push('orderNo')

    // 批号：11 位字母数字
    const batchRaw = extractLabeled(t, FIELD_LABELS.batchNo, '[A-Za-z0-9]{6,20}')
    let batchNo = batchRaw ? cleanBatch(batchRaw) : ''
    if (!batchNo) batchNo = scanBatch(t)
    if (batchNo && !batchIsValid(batchNo)) uncertain.push('batchNo')
    else if (flagMissing && !batchNo) uncertain.push('batchNo')

    // 产品编码：10 位数字
    let productCode = cleanDigits(extractLabeled(t, FIELD_LABELS.productCode, '\\d{10}'))
    if (!productCode) productCode = scanProductCode(t)
    if (productCode && !/^\d{10}$/.test(productCode)) uncertain.push('productCode')
    else if (flagMissing && !productCode) {
        uncertain.push('productCode')
        warnings.push('未识别到产品编码，无法反查物料档案')
    }

    // 产品名称：自由文本
    const productName = extractLabeled(t, FIELD_LABELS.productName, '[^\\n]{2,40}').trim()

    // 包装规格：优先「数字+单位/数字+单位」，兜底取同行剩余
    let packSpec = extractLabeled(t, FIELD_LABELS.packSpec, '\\d+\\s*[瓶罐袋条盒包支听]\\s*/?\\s*\\d*\\s*[箱盒包件]?')
    if (!packSpec) packSpec = extractLabeled(t, FIELD_LABELS.packSpec, '[^\\n]{1,20}').trim()
    if (packSpec) packSpec = packSpec.replace(/\s+/g, '')

    // 计划产量：数字（件/箱）
    const plannedRaw = extractLabeled(t, FIELD_LABELS.plannedQty, '\\d{1,8}')
    let plannedQty = ''
    if (plannedRaw) {
        const n = Number(plannedRaw)
        plannedQty = Number.isFinite(n) ? n : ''
        if (!plannedQty) uncertain.push('plannedQty')
    } else if (flagMissing) {
        uncertain.push('plannedQty')
    }

    // 取样数：多行汇总（允许为空，不强制标黄）
    const sampleCount = extractSampleCount(t)

    return {
        orderNo,
        batchNo,
        productCode,
        productName,
        packSpec,
        plannedQty,
        sampleCount,
        materials: [],
        uncertain: Array.from(new Set(uncertain)),
        warnings,
        parser: 'regex'
    }
}

// 档案复用时原样保留物料编号后缀，只去掉空白。
function normalizeMaterialCode(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '')
}

/**
 * 把 product_materials 档案文档映射成指令单物料行（剔除空编号行，保留编号后缀）。
 * @param {object|null} doc  product-materials 的 get 返回（含 materials[]）
 */
export function buildMaterialsFromArchive(doc) {
    if (!doc || !Array.isArray(doc.materials)) return []
    return doc.materials
        .map((m, i) => ({
            seq: Number.isFinite(Number(m && m.seq)) ? Number(m.seq) : i + 1,
            materialCode: normalizeMaterialCode(m && m.materialCode),
            materialName: String((m && m.materialName) || ''),
            spec: String((m && m.spec) || ''),
            materialVersion: String((m && m.materialVersion) || '') || 'N/A',
            unit: String((m && m.unit) || '')
        }))
        .filter((m) => m.materialCode)
}

/**
 * 用档案补全解析结果：填物料清单 + 补全（仅当本地缺失）产品名称/包装规格。
 * 档案是权威来源，补全项不计入 uncertain。
 * @returns {object} 新的解析对象（不修改入参）
 */
export function enrichFromArchive(parsed, doc) {
    const out = Object.assign({}, parsed, { materials: parsed.materials || [] })
    if (doc && Array.isArray(doc.materials) && doc.materials.length) {
        out.materials = buildMaterialsFromArchive(doc)
        out.materialsSource = 'archive'
    } else {
        out.materialsSource = 'none'
    }
    if (!String(out.productName || '').trim() && doc && doc.productName) {
        out.productName = String(doc.productName)
    }
    if (!String(out.packSpec || '').trim() && doc && doc.packSpec) {
        out.packSpec = String(doc.packSpec)
    }
    return out
}

export { FIELD_NAME }
