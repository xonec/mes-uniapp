'use strict'
const { ClientError } = require('mes-common')

/** 有界文本保留空值，不用猜测值替代缺失数据。 */
function text(value, max = 500) { return value == null ? '' : String(value).trim().slice(0, max) }
/** 提取产品固定包装规格，上托信息单独保存。 */
function basePackSpec(value) { return text(value, 500).replace(/\s*[*×xX]\s*\d+\s*(?:箱|件)\s*\/\s*托\s*$/i, '').trim() }
/** 校验可选的正整数，缺失保持 null。 */
function optionalCount(value, label) {
    if (value === '' || value === undefined || value === null) return null
    const count = Number(value)
    if (!Number.isInteger(count) || count <= 0 || count > 100000) throw new ClientError(label + '须为正整数', 400)
    return count
}
/** 上托配置独立于订单确认状态；有层数时检查箱/层 × 层数。 */
function normalizePallet(input = {}) {
    const pallet = {
        casesPerLayer: optionalCount(input.casesPerLayer, '每层箱数'), layers: optionalCount(input.layers, '层数'), casesPerPallet: optionalCount(input.casesPerPallet, '每托箱数'),
        dimensions: text(input.dimensions, 120), placement: text(input.placement, 2000),
        sourceType: ['customer', 'site', 'document'].includes(input.sourceType) ? input.sourceType : '', sourceNote: text(input.sourceNote, 2000)
    }
    if (pallet.casesPerLayer && pallet.layers) {
        const expected = pallet.casesPerLayer * pallet.layers
        optionalCount(expected, '每托箱数')
        if (pallet.casesPerPallet && pallet.casesPerPallet !== expected) throw new ClientError('每托箱数必须等于每层箱数 × 层数', 400)
        pallet.casesPerPallet = expected
    }
    if (input.status === 'confirmed' && (!pallet.casesPerPallet || !pallet.sourceType || !pallet.sourceNote)) throw new ClientError('确认上托要求时须填写每托箱数、来源和依据说明', 400)
    return { ...pallet, status: input.status === 'confirmed' ? 'confirmed' : 'pending' }
}
/** 解析物料来源页；未知时保留空数组，不声称来自某一页。 */
function sourcePages(value) {
    const pages = Array.isArray(value) ? value : text(value, 40).split(/[,，\s]+/).filter(Boolean)
    if (pages.some(page => !Number.isInteger(Number(page)) || Number(page) < 1 || Number(page) > 6)) throw new ClientError('物料来源页须为1～6的页码，用逗号分隔', 400)
    return Array.from(new Set(pages.map(Number))).sort((a, b) => a - b)
}
/** 服务端记录实际操作人显示名，仅读取姓名字段。 */
async function actorName(db, uid) {
    const user = ((await db.collection('uni-id-users').doc(uid).field({ nickname: true, username: true }).get()).data || [])[0] || {}
    return text(user.nickname || user.username || uid, 120)
}
/** 对已保存的业务字段生成逐字段差异。 */
function changes(before, after, stableKey) {
    return Object.keys(after).filter(key => !['audit', 'updatedAt', 'updatedBy', 'version', '_id', 'changeReason'].includes(key) && stableKey(before && before[key]) !== stableKey(after[key]))
        .map(field => ({ field, before: before && before[field] !== undefined ? before[field] : null, after: after[field] === undefined ? null : after[field] }))
}
module.exports = { text, basePackSpec, optionalCount, normalizePallet, sourcePages, actorName, changes }
