// parseBatchCode 单测：从扫码/相册识别的原文里提取批号
// 运行：node --experimental-detect-module tests/batch-parse.test.mjs
import assert from 'node:assert/strict'
import { parseBatchCode, batchIsValid } from '../utils/product-data.js'

let passed = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

// 1) 干净的批号：直接命中，高置信
t('干净批号直接命中', () => {
    const r = parseBatchCode('OPDG26X1001')
    assert.equal(r.code, 'OPDG26X1001')
    assert.equal(r.matched, true)
})

// 2) 小写 + 带空格/横线：清洗后仍命中
t('清洗后命中', () => {
    const r = parseBatchCode(' opdg-26x1001 ')
    assert.equal(r.code, 'OPDG26X1001')
    assert.equal(r.matched, true)
})

// 3) 前缀带数字（如 001OPDG26X1001）：按窗口切出正确批号，不再盲切前 11 位
t('前缀干扰时切出正确片段', () => {
    const r = parseBatchCode('001OPDG26X1001')
    assert.equal(r.code, 'OPDG26X1001')
    assert.equal(r.matched, true)
})

// 4) 尾部带校验位（OPDG26X1001X）：优先取能对上产品前缀的窗口
t('尾部多余字符时取正确窗口', () => {
    const r = parseBatchCode('OPDG26X1001X')
    assert.equal(r.code, 'OPDG26X1001')
    assert.equal(r.matched, true)
})

// 5) 非批号码（纯数字）：不命中，但仍给出尽力而为的结果供用户确认
t('纯数字不命中', () => {
    const r = parseBatchCode('6901234567892')
    assert.equal(r.matched, false)
    assert.equal(r.code.length, 11)
})

// 6) 未知前缀但形态合法：不命中（低置信），交给用户确认
t('未知前缀为低置信', () => {
    const r = parseBatchCode('ZZZZ26X1001')
    assert.equal(r.code, 'ZZZZ26X1001')
    assert.equal(r.matched, false)
})

// 7) 空内容
t('空内容', () => {
    const r = parseBatchCode('')
    assert.equal(r.code, '')
    assert.equal(r.matched, false)
})

// 8) null / undefined 不炸
t('null 安全', () => {
    assert.equal(parseBatchCode(null).code, '')
    assert.equal(parseBatchCode(undefined).matched, false)
})

// 9) 输出始终通过 batchIsValid（高置信分支）
t('高置信结果一定合法', () => {
    ;['OPDG26X1001', '001OPDG26X1002 ', 'opdg26x1003-x'].forEach(s => {
        const r = parseBatchCode(s)
        assert.equal(r.matched, true)
        assert.ok(batchIsValid(r.code), s + ' → ' + r.code)
    })
})

t('B 单完整保留且允许前后杂字符', () => {
    for (const raw of ['OPDG26X1001B', '001OPDG26X1001B', 'opdg-26x1001-b', '批号 OPDG26X1001B']) {
        const result = parseBatchCode(raw)
        assert.equal(result.code, 'OPDG26X1001B')
        assert.equal(result.matched, true)
        assert.ok(batchIsValid(result.code))
    }
})

for (const [name, fn] of cases) {
    try {
        fn()
        passed++
    } catch (e) {
        console.error('✗ ' + name + '\n  ' + (e && e.message))
        process.exitCode = 1
    }
}
console.log(passed + ' passed, ' + (cases.length - passed) + ' failed')
