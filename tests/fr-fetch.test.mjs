// fr-fetch 纯函数单测：cjkEncode / decodeEntities / parseTable / summarizeBucketCounts
// 运行：node --experimental-detect-module tests/fr-fetch.test.mjs
import assert from 'node:assert/strict'
import { cjkEncode, decodeEntities, parseTable, summarizeBucketCounts } from '../utils/fr-fetch.js'

let passed = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

// 1) cjkEncode：与帆软前端 / 抓包 HAR 逐字节一致
t('cjkEncode 字节一致（对照 HAR）', () => {
    const json = '{"LABEL批号":"批号:","批号":"APDE26X1006"}'
    const expect = '{"LABEL[6279][53f7]":"[6279][53f7]:","[6279][53f7]":"APDE26X1006"}'
    assert.equal(cjkEncode(json), expect)
})

// 2) cjkEncode：'[' ']' 也要转（ASCII 91/93）
t('cjkEncode 转义方括号', () => {
    assert.equal(cjkEncode('a[b]'), 'a[5b]b[5d]')
})

// 3) cjkEncode：纯 ASCII 不变
t('cjkEncode 纯 ASCII 原样', () => {
    assert.equal(cjkEncode('APDE26X1006'), 'APDE26X1006')
})

// 4) decodeEntities：常见实体
t('decodeEntities 常见实体', () => {
    assert.equal(decodeEntities('&lt;a&gt;&amp;&#25105;&#x4E2D;'), '<a>&我中')
})

// 5) parseTable：跳过表头行与「序号」行，解析 6 列数据行 + 实体解码
t('parseTable 解析并跳过表头', () => {
    const html = [
        '<table>',
        '<tr><td>序号</td><td>批号</td><td>桶编码</td><td>数量</td><td>单位</td><td>操作人</td></tr>',
        '<tr><td>1</td><td>APDE26X1006</td><td>A</td><td>9</td><td>件</td><td>张三</td></tr>',
        '<tr><td>2</td><td>APDE26X1006</td><td>B</td><td>8</td><td>件</td><td>李四</td></tr>',
        '</table>'
    ].join('')
    const rows = parseTable(html)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], ['1', 'APDE26X1006', 'A', '9', '件', '张三'])
    assert.deepEqual(rows[1], ['2', 'APDE26X1006', 'B', '8', '件', '李四'])
})

// 6) parseTable：列数不足 6 的行被丢弃
t('parseTable 丢弃非 6 列行', () => {
    const html = '<table><tr><td>a</td></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr></table>'
    assert.equal(parseTable(html).length, 1)
})

// 7) summarizeBucketCounts：按桶编码计数、忽略非 A-J、大小写归一
t('summarizeBucketCounts 计数规则', () => {
    const rows = [
        { 桶编码: 'A' }, { 桶编码: 'A' }, { 桶编码: 'b' },
        { 桶编码: 'Z' }, { 桶编码: '' }, { 桶编码: 'J' }
    ]
    const r = summarizeBucketCounts(rows)
    assert.equal(r.A, 2)
    assert.equal(r.B, 1)
    assert.equal(r.J, 1)
    assert.equal(r.Z, undefined)
    assert.equal(Object.values(r).reduce((a, b) => a + b, 0), 4)
})

// 8) summarizeBucketCounts：空输入返回全 0
t('summarizeBucketCounts 空输入', () => {
    const r = summarizeBucketCounts([])
    assert.deepEqual(Object.keys(r), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    assert.equal(Object.values(r).every(x => x === 0), true)
})

// 9) 端到端：parseTable（数组）→ 映射为对象 → summarizeBucketCounts 串联（模拟 HAR 54 条 A-F 每桶 9 条）
t('parseTable→summarize 串联', () => {
    const rowsHtml = ['A', 'B', 'C', 'D', 'E', 'F'].map(b =>
        Array.from({ length: 9 }, (_, i) =>
            `<tr><td>${i + 1}</td><td>APDE26X1006</td><td>${b}</td><td>1</td><td>件</td><td>op</td></tr>`
        ).join('')
    ).join('')
    const html = '<table><tr><td>序号</td><td>批号</td><td>桶编码</td><td>数量</td><td>单位</td><td>操作人</td></tr>' + rowsHtml + '</table>'
    // 生产代码里 fetchReport 会做这步映射：数组 → 对象
    const objs = parseTable(html).map(r => ({ 序号: r[0], 批号: r[1], 桶编码: r[2], 数量: r[3], 数量单位: r[4], 操作人: r[5] }))
    const r = summarizeBucketCounts(objs)
    assert.equal(r.A, 9)
    assert.equal(r.F, 9)
    assert.equal(Object.values(r).reduce((a, b) => a + b, 0), 54)
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
