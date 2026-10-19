// 排班页 11 位批号展示规则的边界回归：带后缀 / 长度不符 / 含小写 / 空值 都必须按规则处理。
import assert from 'node:assert/strict'
import { DISPLAY_BATCH_PATTERN, displayBatchNo, filterDisplayBatchNos } from '../utils/batch-display.js'

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name + '\n    ' + error.message) }
}

console.log('batch-display:')

await test('规则本身：必须 11 位、同时含字母和数字', async () => {
    assert.equal(DISPLAY_BATCH_PATTERN.source, '^(?=.*[A-Z])(?=.*\\d)[A-Z0-9]{11}$')
    assert.equal(DISPLAY_BATCH_PATTERN.test('AP9Y26X1019'), true)
})

await test('合规 11 位（真实现场数据）原样保留', async () => {
    for (const value of ['AP9Y26X1019', 'AP7D26X1013', 'AP7D26X1014', 'AP7D26X1015']) {
        assert.equal(displayBatchNo(value), value, value + ' 应保留')
    }
})

await test('带 B 后缀（12 位）不展示', async () => {
    assert.equal(displayBatchNo('AP9Y26X1019B'), '')
    assert.equal(displayBatchNo('AP9Y26X1019-B'), '')
    assert.equal(displayBatchNo('AP9Y26X1019B1'), '')
})

await test('长度不符（8/10/12 位）不展示', async () => {
    assert.equal(displayBatchNo('AP9Y26X1'), '')
    assert.equal(displayBatchNo('AP9Y26X101'), '')
    assert.equal(displayBatchNo('AP9Y26X10199'), '')
})

await test('含小写：按大写归一后判断（入库统一大写口径）', async () => {
    assert.equal(displayBatchNo('ap9y26x1019'), 'AP9Y26X1019')
    assert.equal(displayBatchNo('Ap9Y26x1019'), 'AP9Y26X1019')
    // 归一后只有 10 位字母数字的仍拒绝
    assert.equal(displayBatchNo('ap9y26x101'), '')
})

await test('空值：空串 / 空白 / null / undefined 一律不展示', async () => {
    for (const value of ['', '   ', null, undefined]) {
        assert.equal(displayBatchNo(value), '', String(value) + ' 应拒绝')
    }
})

await test('纯数字或纯字母 11 位不展示（必须同时含字母和数字）', async () => {
    assert.equal(displayBatchNo('12345678901'), '')
    assert.equal(displayBatchNo('APYXXYYZZAA'), '')
})

await test('含分隔符/中文/全角等非法字符不展示', async () => {
    assert.equal(displayBatchNo('AP9-Y26X101'), '')
    assert.equal(displayBatchNo('AP9Y26X10 9'), '')
    assert.equal(displayBatchNo('AP9Y26X10一'), '')
    assert.equal(displayBatchNo('ＡＰ９Ｙ２６Ｘ１０１９'), '')
})

await test('前后空格会 trim 后判断', async () => {
    assert.equal(displayBatchNo('  AP9Y26X1019  '), 'AP9Y26X1019')
    assert.equal(displayBatchNo('\nAP9Y26X1019\t'), 'AP9Y26X1019')
})

await test('批量过滤：只留合规项、按原顺序、大小写归一后去重', async () => {
    const rows = [
        'AP9Y26X1019',
        'AP9Y26X1019-B',
        'AP9Y26X1',
        'ap9y26x1019',
        '',
        null,
        'AP7D26X1013',
        '12345678901',
        '  AP7D26X1014 '
    ]
    assert.deepEqual(filterDisplayBatchNos(rows), ['AP9Y26X1019', 'AP7D26X1013', 'AP7D26X1014'])
})

await test('批量过滤：全部不合规时返回空数组（页面显示「本组暂无批号」）', async () => {
    assert.deepEqual(filterDisplayBatchNos(['', null, 'AP9Y26X1019-B', '12345678901']), [])
    assert.deepEqual(filterDisplayBatchNos([]), [])
    assert.deepEqual(filterDisplayBatchNos(null), [])
})

console.log('')
console.log('batch-display: ' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
