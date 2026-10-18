/**
 * 完整生产批号规则（唯一来源）。
 *
 * 现场端页面、utils 与云函数公共模块 mes-common 都从这里取规则；
 * 云函数侧的 CJS 版本由 tools/sync-shared.mjs 生成，禁止手改生成物。
 * 改动规则时必须同时更新下面的版本号，并在交付说明里写明需要重传云函数与重新发版。
 */

/** 规则版本；改动 BATCH_PATTERN 语义时必须递增。 */
export const BATCH_RULE_VERSION = '2026-10-16.1';

/** 11 位字母数字、且须同时含字母和数字，可追加一个 B 单后缀。 */
export const BATCH_PATTERN = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}B?$/;

/** 判断是否为完整生产批号。不做大小写转换，调用方按原逻辑自行 upperCase。 */
export function batchIsValid(value) {
  return BATCH_PATTERN.test(value || '');
}
