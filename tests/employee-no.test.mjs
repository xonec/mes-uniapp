// 占位工号规则（共享源 shared/logic/employee-no.js 的同步副本）
// 运行：node --experimental-detect-module tests/employee-no.test.mjs
import { strict as assert } from 'node:assert'
import {
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_SEQ_LENGTH,
  isPlaceholderEmployeeNo,
  formatPlaceholderEmployeeNo,
  nextPlaceholderSequence
} from '../utils/shared/employee-no.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }

test('前缀为 3 位、流水 6 位', () => {
  assert.equal(PLACEHOLDER_PREFIX.length, 3)
  assert.equal(PLACEHOLDER_SEQ_LENGTH, 6)
})

test('生成：1 → 999000001，边界 999999 → 999999999', () => {
  assert.equal(formatPlaceholderEmployeeNo(1), '999000001')
  assert.equal(formatPlaceholderEmployeeNo(999999), '999999999')
  assert.equal(formatPlaceholderEmployeeNo(42), '999000042')
})

test('生成结果满足现有工号校验（6～20 位数字）', () => {
  for (const n of [1, 7, 100, 999999]) assert.match(formatPlaceholderEmployeeNo(n), /^\d{6,20}$/)
})

test('流水越界拒绝', () => {
  for (const bad of [0, -1, 1000000, NaN, undefined]) assert.throws(() => formatPlaceholderEmployeeNo(bad), /占位工号流水超出范围/)
})

test('判定：真占位号为真，真实工号与畸形值为假', () => {
  assert.equal(isPlaceholderEmployeeNo('999000001'), true)
  assert.equal(isPlaceholderEmployeeNo(' 999000001 '), true)
  for (const value of ['122377', '127557', '99900001', '9990000001', '99900000A', '', null, undefined, 0, {}]) {
    assert.equal(isPlaceholderEmployeeNo(value), false, String(value))
  }
})

test('流水推进：跳过真实工号，从已有占位号最大值 +1', () => {
  assert.equal(nextPlaceholderSequence([]), 1)
  assert.equal(nextPlaceholderSequence(null), 1)
  assert.equal(nextPlaceholderSequence(['122377', '999000007', '999000003', '999000001']), 8)
  assert.equal(nextPlaceholderSequence(['122377', '127557']), 1)
})
