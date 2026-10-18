'use strict'
/** 由 tools/sync-shared.mjs 从 shared/logic 生成，请勿直接修改。 */

// ---------- shared/logic/batch.js ----------
/**
 * 完整生产批号规则（唯一来源）。
 *
 * 现场端页面、utils 与云函数公共模块 mes-common 都从这里取规则；
 * 云函数侧的 CJS 版本由 tools/sync-shared.mjs 生成，禁止手改生成物。
 * 改动规则时必须同时更新下面的版本号，并在交付说明里写明需要重传云函数与重新发版。
 */

/** 规则版本；改动 BATCH_PATTERN 语义时必须递增。 */
const BATCH_RULE_VERSION = '2026-10-16.1';

/** 11 位字母数字、且须同时含字母和数字，可追加一个 B 单后缀。 */
const BATCH_PATTERN = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}B?$/;

/** 判断是否为完整生产批号。不做大小写转换，调用方按原逻辑自行 upperCase。 */
function batchIsValid(value) {
  return BATCH_PATTERN.test(value || '');
}

// ---------- shared/logic/employee-no.js ----------
/**
 * 占位工号规则（唯一来源）。
 *
 * 排班导入遇到系统里还没有的姓名时会自动建档，但排班表里没有工号，
 * 因此需要生成一个"占位工号"：**3 位校验前缀 + 6 位流水**，例如 999000001。
 *
 * 为什么用前缀：
 *   - 一眼可辨：后台列表、排班、报表里看到 999 开头就知道是系统自动建的，尚无身份证档案；
 *   - 不冲突：本厂真实工号为 6 位数字（如 122377、127557），9 位的 999 号段不可能撞上；
 *   - 可校验：isPlaceholderEmployeeNo 能独立判定，不依赖任何数据库标记；
 *   - 满足现有工号校验：6～20 位数字。
 *
 * 占位账号的配套规则（见 uni-id-co 的 createPlaceholderEmployeeAccount）：
 *   status = 1（封禁，不能登录）、随机初始密码、autoCreated = true、不建身份证档案。
 * 管理员补录身份证并启用后，才转为可登录的正式账号。
 */

/** 3 位校验前缀；真实工号若可能占用该号段，只需改这里。 */
const PLACEHOLDER_PREFIX = '999';

/** 流水位数。 */
const PLACEHOLDER_SEQ_LENGTH = 6;

/** 完整占位工号：3 位前缀 + 6 位流水。 */
const PLACEHOLDER_PATTERN = /^999\d{6}$/;

/** 判断是否为本系统生成的占位工号。 */
function isPlaceholderEmployeeNo(value) {
  return PLACEHOLDER_PATTERN.test(String(value == null ? '' : value).trim());
}

/** 由流水号生成占位工号。 */
function formatPlaceholderEmployeeNo(sequence) {
  const n = Math.floor(Number(sequence));
  if (!Number.isFinite(n) || n < 1 || n > 999999) throw new Error('占位工号流水超出范围：1～999999');
  return PLACEHOLDER_PREFIX + String(n).padStart(PLACEHOLDER_SEQ_LENGTH, '0');
}

/** 从已有工号里推进流水号，保证不与历史占位号重复。 */
function nextPlaceholderSequence(existingEmployeeNos) {
  let max = 0;
  for (const value of existingEmployeeNos || []) {
    if (!isPlaceholderEmployeeNo(value)) continue;
    const n = Number(String(value).trim().slice(PLACEHOLDER_PREFIX.length));
    if (n > max) max = n;
  }
  return max + 1;
}

// ---------- shared/logic/material-list.js ----------
/**
 * 包装材料清单的纯数据操作（无 UI、无样式依赖）。
 *
 * 现场端（mes-uniapp）与后台（mes-uniadmin）共用同一份实现；
 * 由 tools/sync-shared.mjs 同步到两个工程的 utils/shared/ 下，禁止各自复制修改。
 * 两端的展示与交互（折叠、确认弹窗、来源页字段形态）各自保留，不在此文件内。
 */

/** 单张单据允许的材料行数上限。 */
const MAX_MATERIAL_ROWS = 200;

/** 新建一行材料的默认形状。 */
function blankMaterialRow(seq) {
  return { seq, materialCode: '', materialName: '', spec: '', materialVersion: null, unit: '' };
}

/** 修改某一行的某个字段，返回新数组。 */
function patchMaterialRow(rows, index, key, value) {
  return (rows || []).map((row, i) => (i === index ? { ...row, [key]: value } : row));
}

/** 追加一行；达到上限返回 null，由调用方决定如何提示。 */
function appendMaterialRow(rows) {
  const current = rows || [];
  if (current.length >= MAX_MATERIAL_ROWS) return null;
  return [...current, blankMaterialRow(current.length + 1)];
}

/** 删除一行并按新顺序重排 seq。 */
function removeMaterialRow(rows, index) {
  return (rows || []).filter((row, i) => i !== index).map((row, i) => ({ ...row, seq: i + 1 }));
}

/** 来源页展示文案：数组、字符串、空值三种形态。 */
function sourcePagesLabel(pages) {
  if (Array.isArray(pages) && pages.length) return pages.join('、');
  if (typeof pages === 'string' && pages) return pages;
  return '未标记';
}

// ---------- shared/logic/pallet.js ----------
/**
 * 上托要求的纯计算规则（无 UI、无样式依赖）。
 *
 * 现场端（mes-uniapp）与后台（mes-uniadmin）共用同一份实现；
 * 由 tools/sync-shared.mjs 同步到两个工程的 utils/shared/ 下，禁止各自复制修改。
 */

/** 由「箱 / 层 × 层数」得到每托箱数；任一项不是正数时返回 null 表示无法推算。 */
function palletCasesPerPallet(casesPerLayer, layers) {
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
function patchPalletField(value, key, next, autoCalculated) {
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
function palletConfirmBlocker(value) {
  if (!Number.isInteger(Number(value.casesPerPallet)) || Number(value.casesPerPallet) <= 0 || !value.sourceType || !String(value.sourceNote || '').trim()) return '请补齐每托箱数、来源和依据';
  return '';
}

// ---------- shared/logic/schedule-batch.js ----------
/**
 * 排班表里的批次号规则（唯一来源）。
 *
 * 后台的 Excel 导入校验（mes-uniadmin）与云端排班写入校验（mes-common → mes-operations）
 * 共用这一份规则；规则版本会随排班记录一起落库，改动前请确认历史数据兼容。
 */

/** 10~40 位字母数字，可含连字符，首尾必须是字母或数字（保留 A/B 后缀与连字符）。 */
const SCHEDULE_BATCH_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9-]{9,38}[A-Za-z0-9]$/;

/** 判断排班批次是否完整；调用方保留各自的错误文案。 */
function scheduleBatchIsValid(value) {
  return SCHEDULE_BATCH_PATTERN.test(value || '');
}

module.exports = { BATCH_RULE_VERSION, BATCH_PATTERN, batchIsValid, PLACEHOLDER_PREFIX, PLACEHOLDER_SEQ_LENGTH, PLACEHOLDER_PATTERN, isPlaceholderEmployeeNo, formatPlaceholderEmployeeNo, nextPlaceholderSequence, MAX_MATERIAL_ROWS, blankMaterialRow, patchMaterialRow, appendMaterialRow, removeMaterialRow, sourcePagesLabel, palletCasesPerPallet, patchPalletField, palletConfirmBlocker, SCHEDULE_BATCH_PATTERN, scheduleBatchIsValid }
