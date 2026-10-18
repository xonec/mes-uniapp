// 产品目录与批号精确映射（移植自原型 android/index.html）
// 真实接入时替换为后台下发的数据

export const productCatalog = [
    { prefix: 'OPDG', code: '1306005930', perCase: 6, perPallet: 49, name: 'OPDG 六瓶装' },
    { prefix: 'OPDG', code: '1306005929', perCase: 4, perPallet: 36, name: 'OPDG 四瓶装' }
]

export const exactBatch = {
    OPDG26X1001: { productCode: '1306005930', perCase: 6, perPallet: 49 },
    OPDG26X1002: { productCode: '1306005930', perCase: 6, perPallet: 49 },
    OPDG26X1003: { productCode: '1306005929', perCase: 4, perPallet: 36 }
}

// 批号为 11 位字母数字；B 单追加末尾 B，关联时使用完整编码。
// 批号规则来自共享模块（唯一来源：shared/logic/batch.js）
import { batchIsValid } from './shared/batch.js'
export { batchIsValid }

export function productMatches(batch) {
    return productCatalog.filter(p => p.prefix === String(batch || '').slice(0, 4).toUpperCase())
}

// 根据批号推导出候选产品编码、件/瓶、件/托
export function resolveProduct(batch) {
    const exact = exactBatch[batch]
    if (exact) return exact
    const matches = productMatches(batch)
    if (matches.length === 1) return { productCode: matches[0].code, perCase: matches[0].perCase, perPallet: matches[0].perPallet }
    return null
}

/** 从扫码原文提取完整批号，B 单不截断；不能识别时交由用户核对。 */
export function parseBatchCode(raw) {
    const rawStr = String(raw == null ? '' : raw)
    const cleaned = rawStr.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const prefixes = productCatalog.map(product => product.prefix)
    let fallback = ''
    for (let index = 0; index + 11 <= cleaned.length; index++) {
        const base = cleaned.slice(index, index + 11)
        if (!batchIsValid(base)) continue
        const code = cleaned[index + 11] === 'B' ? base + 'B' : base
        if (prefixes.includes(base.slice(0, 4))) return { code, matched: true, raw: rawStr, cleaned }
        if (!fallback) fallback = code
    }
    return { code: fallback || cleaned.slice(0, 11), matched: false, raw: rawStr, cleaned }
}
