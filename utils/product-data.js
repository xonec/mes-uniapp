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

// 批号：11 位，且同时包含字母与数字
export const batchIsValid = (value) => /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/.test(value || '')

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

// 从扫码 / 相册识别 / 粘贴的原文中提取批号
// 返回 { code, matched, raw, cleaned }
//   matched = true 表示命中「合法的 11 位片段，且前 4 位能在产品目录里找到」——高置信，可直接使用
//   matched = false 只表示「没找到高置信片段」，code 仍给出尽力而为的结果，由调用方决定是否要用户确认
export function parseBatchCode(raw) {
    const rawStr = String(raw == null ? '' : raw)
    const cleaned = rawStr.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!cleaned) return { code: '', matched: false, raw: rawStr, cleaned }
    const prefixes = productCatalog.map(p => p.prefix)
    let fallback = ''
    for (let i = 0; i + 11 <= cleaned.length; i++) {
        const w = cleaned.slice(i, i + 11)
        if (!batchIsValid(w)) continue
        if (prefixes.indexOf(w.slice(0, 4)) >= 0) return { code: w, matched: true, raw: rawStr, cleaned }
        if (!fallback) fallback = w
    }
    if (fallback) return { code: fallback, matched: false, raw: rawStr, cleaned }
    return { code: cleaned.slice(0, 11), matched: false, raw: rawStr, cleaned }
}
