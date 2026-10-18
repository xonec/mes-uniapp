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
export const PLACEHOLDER_PREFIX = '999';

/** 流水位数。 */
export const PLACEHOLDER_SEQ_LENGTH = 6;

/** 完整占位工号：3 位前缀 + 6 位流水。 */
export const PLACEHOLDER_PATTERN = /^999\d{6}$/;

/** 判断是否为本系统生成的占位工号。 */
export function isPlaceholderEmployeeNo(value) {
  return PLACEHOLDER_PATTERN.test(String(value == null ? '' : value).trim());
}

/** 由流水号生成占位工号。 */
export function formatPlaceholderEmployeeNo(sequence) {
  const n = Math.floor(Number(sequence));
  if (!Number.isFinite(n) || n < 1 || n > 999999) throw new Error('占位工号流水超出范围：1～999999');
  return PLACEHOLDER_PREFIX + String(n).padStart(PLACEHOLDER_SEQ_LENGTH, '0');
}

/** 从已有工号里推进流水号，保证不与历史占位号重复。 */
export function nextPlaceholderSequence(existingEmployeeNos) {
  let max = 0;
  for (const value of existingEmployeeNos || []) {
    if (!isPlaceholderEmployeeNo(value)) continue;
    const n = Number(String(value).trim().slice(PLACEHOLDER_PREFIX.length));
    if (n > max) max = n;
  }
  return max + 1;
}
