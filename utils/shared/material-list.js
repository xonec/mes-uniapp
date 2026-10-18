/**
 * 包装材料清单的纯数据操作（无 UI、无样式依赖）。
 *
 * 现场端（mes-uniapp）与后台（mes-uniadmin）共用同一份实现；
 * 由 tools/sync-shared.mjs 同步到两个工程的 utils/shared/ 下，禁止各自复制修改。
 * 两端的展示与交互（折叠、确认弹窗、来源页字段形态）各自保留，不在此文件内。
 */

/** 单张单据允许的材料行数上限。 */
export const MAX_MATERIAL_ROWS = 200;

/** 新建一行材料的默认形状。 */
export function blankMaterialRow(seq) {
  return { seq, materialCode: '', materialName: '', spec: '', materialVersion: null, unit: '' };
}

/** 修改某一行的某个字段，返回新数组。 */
export function patchMaterialRow(rows, index, key, value) {
  return (rows || []).map((row, i) => (i === index ? { ...row, [key]: value } : row));
}

/** 追加一行；达到上限返回 null，由调用方决定如何提示。 */
export function appendMaterialRow(rows) {
  const current = rows || [];
  if (current.length >= MAX_MATERIAL_ROWS) return null;
  return [...current, blankMaterialRow(current.length + 1)];
}

/** 删除一行并按新顺序重排 seq。 */
export function removeMaterialRow(rows, index) {
  return (rows || []).filter((row, i) => i !== index).map((row, i) => ({ ...row, seq: i + 1 }));
}

/** 来源页展示文案：数组、字符串、空值三种形态。 */
export function sourcePagesLabel(pages) {
  if (Array.isArray(pages) && pages.length) return pages.join('、');
  if (typeof pages === 'string' && pages) return pages;
  return '未标记';
}
