'use strict'

// 订单保存后自动同步产品 BOM：仅在订单带 productCode 且 materials 非空时执行。
// 规则：内容不变幂等；变化才升 bomVersion 并把旧快照归档到 product_bom_versions。
// 订单没有 BOM 的用量参数，同 materialCode 的已有行保留原参数，只更新描述字段；
// 新增行给安全默认并回传 needsConfig 供人工补。

const BOM_COLL = 'product_bom'
const VERSIONS_COLL = 'product_bom_versions'

function text(value, max) {
    const s = value === undefined || value === null ? '' : String(value).trim()
    return max && s.length > max ? s.slice(0, max) : s
}

function numberOr(value, fallback) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function bomId(productCode) { return 'bom:' + String(productCode) }

/** 订单只提供描述字段；BOM 的计算参数由 BOM 自己维护。 */
function descriptionRows(materials) {
    return (Array.isArray(materials) ? materials : []).map((row, index) => {
        row = row || {}
        return {
            seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : index + 1,
            materialCode: text(row.materialCode, 40),
            materialName: text(row.materialName, 120),
            spec: text(row.spec, 200),
            materialVersion: text(row.materialVersion, 20) || 'N/A',
            unit: text(row.unit, 12)
        }
    }).filter(row => row.materialCode)
}

/** 内容签名：订单可见的描述字段 + 行序（不含 BOM 计算参数）。 */
function contentSignature(materials, productName, packSpec) {
    return JSON.stringify({
        productName: text(productName, 120),
        packSpec: text(packSpec, 120),
        materials: descriptionRows(materials).map(row => [row.seq, row.materialCode, row.materialName, row.spec, row.materialVersion, row.unit])
    })
}

/** 订单里没有用量参数，新增 BOM 行先给安全默认，人工再补。 */
function safeDefaults() {
    return { category: 'other', basis: 'manual', qtyPerBasis: 1, wasteRate: 0, roundMode: 'ceil', manualQty: 0 }
}

/** 保留已有行的计算参数，只把订单描述字段覆盖上去。 */
function mergeRow(row, previous) {
    const merged = { ...row, ...safeDefaults() }
    if (!previous) return merged
    return {
        ...row,
        category: text(previous.category, 20) || 'other',
        basis: text(previous.basis, 20) || 'manual',
        qtyPerBasis: numberOr(previous.qtyPerBasis, 1),
        wasteRate: numberOr(previous.wasteRate, 0),
        roundMode: text(previous.roundMode, 20) || 'ceil',
        manualQty: numberOr(previous.manualQty, 0),
        ...(text(previous.supplied, 20) ? { supplied: text(previous.supplied, 20) } : {}),
        ...(text(previous.note, 200) ? { note: text(previous.note, 200) } : {})
    }
}

async function saveArchive(db, doc) {
    try { await db.collection(VERSIONS_COLL).add(doc) }
    catch (error) {
        // 同一版本的快照已存在（例如上次更新后重试）视为幂等，不覆盖历史。
        if (!/duplicate|exist|already|重复|已存在/i.test(String(error && (error.message || error.errMsg) || ''))) throw error
    }
}

/** 同步订单物料到产品 BOM；返回值由订单保存接口原样透出。 */
async function syncOrderBom(db, order, uid) {
    const productCode = text(order && order.productCode, 40)
    const materials = descriptionRows(order && order.materials)
    if (!productCode || !materials.length) return { action: 'skipped' }
    const productName = text(order.productName, 120)
    const packSpec = text(order.packSpec, 120)
    const orderNo = text(order.orderNo, 12)
    const signature = contentSignature(materials, productName, packSpec)
    const coll = db.collection(BOM_COLL)
    const existing = ((await coll.doc(bomId(productCode)).get()).data || [])[0] || null

    if (!existing) {
        const now = Date.now()
        const doc = {
            _id: bomId(productCode), productCode, productName, packSpec,
            materials: materials.map(row => ({ ...row, ...safeDefaults() })),
            bomVersion: 1, source: 'order', sourceOrderNo: orderNo, enabled: true,
            updatedAt: now, updatedBy: text(uid, 80)
        }
        await coll.add(doc)
        return { action: 'created', version: 1, needsConfig: materials.map(row => row.materialCode) }
    }

    if (contentSignature(existing.materials, existing.productName, existing.packSpec) === signature) return { action: 'unchanged' }

    const oldVersion = numberOr(existing.bomVersion, 1)
    await saveArchive(db, {
        _id: 'ver:' + productCode + ':' + oldVersion,
        productCode, bomVersion: oldVersion,
        materials: Array.isArray(existing.materials) ? existing.materials : [],
        updatedAt: numberOr(existing.updatedAt, 0), updatedBy: text(existing.updatedBy, 80),
        sourceOrderNo: text(existing.sourceOrderNo, 12), savedAt: Date.now()
    })

    const previousByCode = new Map((Array.isArray(existing.materials) ? existing.materials : []).map(row => [text(row && row.materialCode, 40), row]))
    const needsConfig = []
    const nextMaterials = materials.map(row => {
        const previous = previousByCode.get(row.materialCode)
        if (!previous) needsConfig.push(row.materialCode)
        return mergeRow(row, previous)
    })
    const version = oldVersion + 1
    await coll.doc(bomId(productCode)).update({
        productName, packSpec, materials: nextMaterials,
        bomVersion: version, source: 'order', sourceOrderNo: orderNo,
        updatedAt: Date.now(), updatedBy: text(uid, 80)
    })
    return { action: 'updated', version, needsConfig }
}

module.exports = { syncOrderBom, contentSignature, descriptionRows, safeDefaults }
