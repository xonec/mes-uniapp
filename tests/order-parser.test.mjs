// order-parser 单测：正则提取指令单表头 + 档案反查物料
// 运行：node --experimental-detect-module tests/order-parser.test.mjs
import assert from 'node:assert/strict'
import {
    parseOrderSheet,
    buildMaterialsFromArchive,
    enrichFromArchive,
    batchIsValid,
    cleanBatch,
    cleanDigits
} from '../utils/order-parser.js'

let passed = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

// 标准指令单样例（含多行取样，合计 10+3+2+2=17）
const SAMPLE = [
    '订单号：559288',
    '生产批号：APDE26X1007',
    '产品编码：1306008058',
    '产品名称：FoYes分离乳清蛋白粉（锡兰红茶味）',
    '包装规格：4瓶/箱',
    '计划产量：250',
    '取样数量：成品10',
    '取样：精密3',
    '取样：菌检2',
    '取样：留样2'
].join('\n')

// 1) 标准样例：全部字段正确
t('标准样例提取全部字段', () => {
    const r = parseOrderSheet(SAMPLE)
    assert.equal(r.orderNo, '559288')
    assert.equal(r.batchNo, 'APDE26X1007')
    assert.equal(r.productCode, '1306008058')
    assert.equal(r.productName, 'FoYes分离乳清蛋白粉（锡兰红茶味）')
    assert.equal(r.packSpec, '4瓶/箱')
    assert.equal(r.plannedQty, 250)
    assert.equal(r.sampleCount, '17')
    assert.equal(r.parser, 'regex')
})

// 2) 全角冒号 + 多余空格
t('全角冒号与空格清洗', () => {
    const r = parseOrderSheet('订单号  ： 559288\n批号：apde26x1007\n产品编码：1306008058')
    assert.equal(r.orderNo, '559288')
    assert.equal(r.batchNo, 'APDE26X1007') // 小写转大写
    assert.ok(r.uncertain.indexOf('batchNo') < 0)
})

// 3) 批号扫描兜底（无标签但文本含合法批号）
t('批号扫描兜底', () => {
    const r = parseOrderSheet('本批 APDE26X1007 将于下月生产，订单 559288')
    assert.equal(r.batchNo, 'APDE26X1007')
    assert.equal(r.orderNo, '559288')
})

// 4) 批号非法形态 → 标黄
t('批号过短标黄', () => {
    const r = parseOrderSheet('批号：APDE26X')
    assert.equal(r.batchNo, 'APDE26X')
    assert.ok(r.uncertain.indexOf('batchNo') >= 0)
})

// 5) 缺产品编码 → uncertain + warning
t('缺产品编码标黄并告警', () => {
    const r = parseOrderSheet('订单号：559288\n批号：APDE26X1007')
    assert.ok(r.uncertain.indexOf('productCode') >= 0)
    assert.ok(r.warnings.some(w => /产品编码/.test(w)))
})

// 6) 取样数多行汇总
t('取样数多行汇总为 17', () => {
    const r = parseOrderSheet(SAMPLE)
    assert.equal(r.sampleCount, '17')
})

// 7) 包装规格提取（数字+单位/数字+单位）
t('包装规格提取', () => {
    const r = parseOrderSheet('包装规格：6罐/箱')
    assert.equal(r.packSpec, '6罐/箱')
})

// 8) 产品名称自由文本
t('产品名称提取', () => {
    const r = parseOrderSheet('产品名称：某某蛋白粉（原味）')
    assert.equal(r.productName, '某某蛋白粉（原味）')
})

// 9) 产品编码扫描兜底
t('产品编码扫描兜底', () => {
    const r = parseOrderSheet('货号1306008058，批号APDE26X1007')
    assert.equal(r.productCode, '1306008058')
})

// 10) 空/ null 安全
t('空与 null 安全', () => {
    assert.doesNotThrow(() => parseOrderSheet(''))
    assert.doesNotThrow(() => parseOrderSheet(null))
    assert.doesNotThrow(() => parseOrderSheet(undefined))
    const r = parseOrderSheet('')
    assert.equal(r.orderNo, '')
    assert.deepEqual(r.materials, [])
})

// 11) flagMissing=false 时不把缺失计入 uncertain
t('flagMissing=false 不标黄', () => {
    const r = parseOrderSheet('订单号：559288', { flagMissing: false })
    assert.equal(r.orderNo, '559288')
    assert.equal(r.uncertain.length, 0)
})

// 12) buildMaterialsFromArchive：剔除空编号、保留物料编号后缀
t('buildMaterialsFromArchive 清洗', () => {
    const doc = {
        materials: [
            { seq: 1, materialCode: '1314001003-1', materialName: '蛋白粉', spec: 'APDE', materialVersion: 'N/A', unit: '千克' },
            { seq: 2, materialCode: '', materialName: '空编号', unit: '只' }, // 应被过滤
            { seq: 3, materialCode: '1314001004', materialName: '罐', unit: '罐' }
        ]
    }
    const mats = buildMaterialsFromArchive(doc)
    assert.equal(mats.length, 2)
    assert.equal(mats[0].materialCode, '1314001003-1')
    assert.equal(mats[1].materialCode, '1314001004')
})

// 13) buildMaterialsFromArchive：null / 无 materials
t('buildMaterialsFromArchive 空文档', () => {
    assert.deepEqual(buildMaterialsFromArchive(null), [])
    assert.deepEqual(buildMaterialsFromArchive({}), [])
})

// 14) enrichFromArchive：填物料 + 补全缺失名称/规格
t('enrichFromArchive 补全', () => {
    const parsed = parseOrderSheet('订单号：559288\n批号：APDE26X1007') // 无名称/规格/物料
    const doc = {
        productName: '档案名',
        packSpec: '4瓶/箱',
        materials: [{ seq: 1, materialCode: '1314001003', materialName: '粉', unit: '千克' }]
    }
    const out = enrichFromArchive(parsed, doc)
    assert.equal(out.productName, '档案名')
    assert.equal(out.packSpec, '4瓶/箱')
    assert.equal(out.materials.length, 1)
    assert.equal(out.materialsSource, 'archive')
    // 补全项不计入 uncertain
    assert.ok(out.uncertain.indexOf('productName') < 0)
    assert.ok(out.uncertain.indexOf('packSpec') < 0)
})

// 15) enrichFromArchive：本地已有名称不被覆盖
t('enrichFromArchive 不覆盖本地名称', () => {
    const parsed = parseOrderSheet(SAMPLE)
    const out = enrichFromArchive(parsed, { productName: '档案名', materials: [] })
    assert.equal(out.productName, 'FoYes分离乳清蛋白粉（锡兰红茶味）')
    assert.equal(out.materialsSource, 'none')
})

// 16) 工具函数
t('cleanBatch/cleanDigits/batchIsValid', () => {
    assert.equal(cleanBatch(' ap-de26x1007 '), 'APDE26X1007')
    assert.equal(cleanDigits('13-14-001003'), '1314001003')
    assert.ok(batchIsValid('APDE26X1007'))
    assert.ok(!batchIsValid('APDE26X')) // 太短
    assert.ok(!batchIsValid('12345678901')) // 无字母
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
