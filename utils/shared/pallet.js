/**
 * 上托要求的纯计算规则（无 UI、无样式依赖）。
 *
 * 现场端（mes-uniapp）与后台（mes-uniadmin）共用同一份实现；
 * 由 tools/sync-shared.mjs 同步到两个工程的 utils/shared/ 下，禁止各自复制修改。
 */

/** 由「箱 / 层 × 层数」得到每托箱数；任一项不是正数时返回 null 表示无法推算。 */
export function palletCasesPerPallet(casesPerLayer, layers) {
  return Number(casesPerLayer) > 0 && Number(layers) > 0 ? Number(casesPerLayer) * Number(layers) : null;
}

/**
 * 修改一个上托字段，并同步由层数推算出的箱 / 托。
 *
 * @param {object} value 当前上托数据
 * @param {string} key 被修改的字段
 * @param {*} next 新值
 * @param {boolean} autoCalculated 上一轮箱 / 托是否由本规则自动算出
 * @returns {{value: object, autoCalculated: boolean}} 新的上托数据与新的自动计算标志
 */
export function patchPalletField(value, key, next, autoCalculated) {
  const result = { ...value, [key]: next };
  let auto = !!autoCalculated;
  if (key === 'casesPerPallet') auto = false;
  if (key === 'casesPerLayer' || key === 'layers') {
    const total = palletCasesPerPallet(result.casesPerLayer, result.layers);
    if (total != null) { result.casesPerPallet = total; auto = true; }
    else if (auto) { result.casesPerPallet = ''; result.status = 'pending'; }
  }
  return { value: result, autoCalculated: auto };
}

/** 确认上托前必须补齐的条件；返回空串表示可以确认，否则返回提示文案。 */
export function palletConfirmBlocker(value) {
  if (!Number.isInteger(Number(value.casesPerPallet)) || Number(value.casesPerPallet) <= 0 || !value.sourceType || !String(value.sourceNote || '').trim()) return '请补齐每托箱数、来源和依据';
  return '';
}
