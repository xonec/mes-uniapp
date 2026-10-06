'use strict'
const { ClientError } = require('mes-common')

const value = input => input == null ? '' : String(input).trim()
const quantity = input => input != null && /^\d+(?:\.\d+)?$/.test(String(input).trim()) ? Number(input) : ''

/** 将完整单据 JSON 映射为现有 BOM/订单字段，并保留原始转录及原始结构供核对。 */
function normalizeDocument(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ClientError('模型未返回有效单据 JSON', 502)
    const info = document.structured_info || document.structuredInfo
    if (!info || typeof info !== 'object' || Array.isArray(info)) return document
    const products = Array.isArray(info.products) ? info.products : []
    const codes = Array.from(new Set(products.map(product => value(product && product.product_code)).filter(code => /^\d{10}$/.test(code))))
    if (codes.length > 1) throw new ClientError('照片包含不同产品编码，请按产品分开导入，已停止后续模型', 400)
    const product = products[0] || {}
    const materials = Array.isArray(info.packing_materials) ? info.packing_materials : []
    const uncertain = Array.isArray(document.uncertain) ? document.uncertain.filter(field => typeof field === 'string') : []
    const out = {
        orderNo: value(info.order_no || product.order_no),
        batchNo: value(info.production_batch_no),
        productCode: value(product.product_code || info.product_code),
        productName: value(product.product_name || info.product_name),
        packSpec: value(product.packing_spec || info.packing_spec),
        plannedQty: quantity(product.planned_output_case),
        sampleCount: value(info.sample_count) || (Array.isArray(info.remarks) ? info.remarks.filter(line => /取样|留样|菌检|精密/.test(String(line))).join('\n') : ''),
        packingBatchNo: value(info.packing_batch_no),
        rawPackSpec: value(product.packing_spec || info.packing_spec),
        materials: materials.slice(0, 200).map((row, index) => ({
            seq: index + 1, materialCode: value(row && row.material_code), materialName: value(row && row.material_name),
            spec: value(row && row.spec_model), materialVersion: value(row && row.material_version) || null, unit: value(row && row.unit), sourcePages: row && row.source_pages || []
        })),
        uncertain,
        plannedQtyRaw: product.planned_output_case == null ? '' : value(product.planned_output_case),
        recognitionDocument: { raw_text: value(document.raw_text).slice(0, 100000), structured_info: info }
    }
    if (out.plannedQty === '' && product.planned_output_bottle != null) {
        const count = out.packSpec.match(/(?:[×xX*]\s*)?(\d+)\s*(?:瓶|罐|袋|盒|包|支|个)\s*\/\s*(?:箱|件)/)
        const bottles = quantity(product.planned_output_bottle)
        if (count && Number(count[1]) > 0 && bottles !== '') out.plannedQty = bottles / Number(count[1])
    }
    const requirements = Array.isArray(info.packing_requirements) ? info.packing_requirements.map(value).join('\n') : ''
    const layered = requirements.match(/(\d+)\s*(?:箱|件)\s*[/／]\s*层\s*[*×xX]\s*(\d+)\s*层\s*[=＝]\s*(\d+)\s*(?:箱|件)\s*[/／]\s*托/)
    const perPallet = (out.packSpec + '\n' + requirements).match(/(\d+)\s*(?:箱|件)\s*[/／]\s*托/)
    if (layered || perPallet) out.pallet = { status: 'pending', casesPerLayer: layered ? Number(layered[1]) : null, layers: layered ? Number(layered[2]) : null, casesPerPallet: Number(layered ? layered[3] : perPallet[1]), dimensions: '', placement: '', sourceType: 'document', sourceNote: layered ? layered[0] : perPallet[0] }
    if (out.sampleCount === '' && !uncertain.includes('sampleCount')) uncertain.push('sampleCount')
    return out
}
module.exports = { normalizeDocument }
