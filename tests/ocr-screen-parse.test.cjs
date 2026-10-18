// OCR.space 免费识别解析回归：真实 Engine 2 响应（2026-10-18 真机用图 zld-1.jpg）。
// 关键 bug：parsePages 曾用空的字段提取结果覆盖 parseOrderSheet 已扫描到的 10 位编码。
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const root = path.join(__dirname, '../uniCloud-alipay/cloudfunctions')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'uni-id-common') return path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
    if (['mes-common', 'order-parser'].includes(request)) return path.join(root, 'common', request, 'index.js')
    return resolve.call(this, request, ...args)
}
const { parsePages } = require(path.join(root, 'doc-ocr/ocr-space.js'))
const fixture = require('./fixtures/ocr-space-zld1.json')

let passed = 0, failed = 0
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name + '\n    ' + error.message) }
}

console.log('ocr-screen-parse:')
const page = fixture.ParsedResults[0]

test('真实 Engine 2 响应能拿到产品编码 1306007453', () => {
    const parsed = parsePages([page], 'order')
    assert.equal(parsed.productCode, '1306007453')
    assert.deepEqual(parsed.detectedProductCodes, ['1306007453'])
})

test('同页还能提取订单号与批号', () => {
    const parsed = parsePages([page], 'order')
    assert.equal(parsed.orderNo, '565077')
    assert.equal(parsed.batchNo, 'AP9Y26X1019')
})

test('回归：位置提取为空时不得清空 parseOrderSheet 扫到的编码（跨行表头）', () => {
    // 只有 ParsedText、没有 TextOverlay；标签与数值跨行，位置提取必然为空。
    const parsed = parsePages([{ ParsedText: '产品编码\t产品名称\n包装规格（件）\n1306007453' }], 'order')
    assert.equal(parsed.productCode, '1306007453')
    assert.deepEqual(parsed.detectedProductCodes, ['1306007453'])
})

test('OCR.space 逐字表头仍能定位产品编码列（findLabel 行内拼接）', () => {
    const parsed = parsePages([page], 'order')
    assert.equal(parsed.productCode, '1306007453')
    assert.equal(parsed.productName.replace(/\s+/g, '').includes('东方甄选'), true)
})

console.log('')
if (failed) { console.error('ocr-screen-parse: ' + failed + ' failed'); process.exitCode = 1 }
else console.log('ocr-screen-parse: ' + passed + ' passed, 0 failed')
