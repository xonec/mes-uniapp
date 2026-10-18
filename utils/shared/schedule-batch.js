/**
 * 排班表里的批次号规则（唯一来源）。
 *
 * 后台的 Excel 导入校验（mes-uniadmin）与云端排班写入校验（mes-common → mes-operations）
 * 共用这一份规则；规则版本会随排班记录一起落库，改动前请确认历史数据兼容。
 */

/** 10~40 位字母数字，可含连字符，首尾必须是字母或数字（保留 A/B 后缀与连字符）。 */
export const SCHEDULE_BATCH_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9-]{9,38}[A-Za-z0-9]$/;

/** 判断排班批次是否完整；调用方保留各自的错误文案。 */
export function scheduleBatchIsValid(value) {
  return SCHEDULE_BATCH_PATTERN.test(value || '');
}
