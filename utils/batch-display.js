/**
 * 排班页批号展示规则（唯一来源，纯函数，方便单测）。
 *
 * 与 shared/logic/batch.js 的 BATCH_PATTERN 不同：展示规则更严，只认 **11 位**、
 * 同时含字母和数字的批号；带 B 后缀、长度不符、空值一律不展示。
 * 入库数据统一大写，这里仍做 trim + 大写归一，避免历史数据大小写不一致。
 */
export const DISPLAY_BATCH_PATTERN = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/

/**
 * 把原始批号归一成可展示的 11 位批号；不合规返回空串。
 * @param {*} value 原始批号
 * @returns {string} 合规时返回大写批号，否则返回 ''
 */
export function displayBatchNo(value) {
    const text = String(value == null ? '' : value).trim().toUpperCase()
    return DISPLAY_BATCH_PATTERN.test(text) ? text : ''
}

/**
 * 过滤一批批号，保留合规项并按原顺序去重。
 * @param {Array} list 原始批号数组
 * @returns {string[]} 合规批号（大写、去重、保序）
 */
export function filterDisplayBatchNos(list) {
    const seen = new Set()
    const output = []
    for (const value of list || []) {
        const batchNo = displayBatchNo(value)
        if (!batchNo || seen.has(batchNo)) continue
        seen.add(batchNo)
        output.push(batchNo)
    }
    return output
}
