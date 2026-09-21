// 产品 BOM 计算单元测试（node 运行：node --experimental-detect-module tests/bom.test.mjs）
//
// ⚠⚠ 数据来源声明（2026-09-20）⚠⚠
//   下面的 fixture **不是真实「包装指令单」的抄录**，而是**示意数据**（数值自洽，但未经证实）。
//   原因：当前模型（custom-local:deepseek-v4-flash）**不能读图** —— Read 图片只会返回
//   「current model does not support reading images」，早前所谓「直读指令单逐行抄录」是凭空生成的。
//   ⇒ 本文件只验证 **公式与解析函数的自洽性**（改公式必须让它全绿）；
//     **不得**据此认为结果「与纸质单据一致」。用例里的订单号/产品编码/物料编号均为**占位**。
//   ⇒ 真实数据到位后，请用真值替换 fixture 并重新对照一次。

import assert from 'node:assert'
import {
    computeBom, computeBomByBottles, computeRowQty, sumBomByUnit,
    parsePackSpec, matchBomByBatch, resolveLevelCounts, levelsFromBom, BOM_BASIS
} from '../utils/bom.js'

let passed = 0
let failed = 0
function test(name, fn) {
    try {
        fn()
        passed++
        console.log('  ✓ ' + name)
    } catch (e) {
        failed++
        console.error('  ✗ ' + name)
        console.error('    ' + (e.message || e))
    }
}

// ═══════ 以下 fixture 全部为**示意数据** ═══════
// 字段结构按设计模型书写；数值仅用于自洽性回归，来源未经证实，勿当真实单据。

// ── 示意 A：瓶/箱/托（两级换算，36 瓶/箱、64 箱/托），批量 21000 瓶；用**旧字段**（bottlePerCase/casePerPallet + basis:'bottle'）──
const BOM_CREATINE = {
    productCode: '1306003790',
    productName: '肌酸粉',
    packSpec: 'OP7F-200g/瓶*36瓶/箱*64箱/托',
    batchPrefix: 'OP7F',
    bottlePerCase: 36,
    casePerPallet: 64,
    bottleWeightKg: 0.2,
    materials: [
        { seq: 1, materialCode: '1314000418-1', materialName: '肌酸粉-混合', spec: 'OP7F', materialVersion: 'N/A', unit: '千克', category: 'powder', basis: 'bottle', qtyPerBasis: 0.2, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '3100003463', materialName: '标签-OP7F', spec: '200g/瓶-ON-长宽242*72mm-白格TC58-5QS', materialVersion: '02', unit: '只', category: 'label', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '3203012158', materialName: '黑色普通盖-铭达', spec: '口径78.9±0.5mm-无字易撕瓶片（单耳）', materialVersion: 'N/A', unit: '只', category: 'cap', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.015 },
        { seq: 4, materialCode: '3204010184', materialName: 'MD-1157黑色HDPE瓶-铭达', spec: '380mlHDPE黑色圆瓶-瓶直径78.5±1mm，瓶高100.8±1.5mm', materialVersion: 'N/A', unit: '只', category: 'bottle', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.015 },
        { seq: 5, materialCode: '3209000200', materialName: '4cc白色平底勺-泉金', spec: '4cc-白色-PP', materialVersion: 'N/A', unit: '只', category: 'spoon', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.03 },
        { seq: 6, materialCode: '3302000209', materialName: '大衬板', spec: '1175*975mm', materialVersion: 'N/A', unit: '张', category: 'board', basis: 'pallet', qtyPerBasis: 2, wasteRate: 0 },
        { seq: 7, materialCode: '3302001002', materialName: '空白纸箱', spec: '490*250*220mm-A7A/A', materialVersion: 'N/A', unit: '只', category: 'case', basis: 'case', qtyPerBasis: 1, wasteRate: 0.01 },
        { seq: 8, materialCode: '3309000090', materialName: '透明胶带', spec: '6cm*50m', materialVersion: 'N/A', unit: '卷', category: 'tape', basis: 'case', qtyPerBasis: 0.052, wasteRate: 0 }
    ]
}

// ── 示意 B：瓶/箱（单级换算，6 瓶/箱），批量 4950 瓶；旧字段；含客供件 ──
const BOM_WHEY = {
    productCode: '1306008137',
    productName: 'FoYes分离乳清蛋白粉（蜜桃味）',
    packSpec: 'APD8-FoYes-750g/瓶*6瓶/箱',
    batchPrefix: 'APD8',
    bottlePerCase: 6,
    casePerPallet: 0,
    bottleWeightKg: 0.75,
    materials: [
        { seq: 1, materialCode: '1314000999-1', materialName: 'FoYes分离乳清蛋白粉（蜜桃味）-混合', spec: 'APD8', unit: '千克', category: 'powder', basis: 'bottle', qtyPerBasis: 0.75, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '3100005115', materialName: '标签-KL26136-APD8', spec: '1.65磅-蜜桃味-478*130mm-亮银BOPP', materialVersion: '01', unit: '只', category: 'label', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '3209000229', materialName: '80cc高温勺', spec: '80cc勺子-独立包装（干机）', unit: '只', category: 'spoon', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 4, materialCode: '3302001351', materialName: '空白纸箱', spec: '494*332*230mm-A7K/C-印刷标志-倒角', unit: '只', category: 'case', basis: 'case', qtyPerBasis: 1, wasteRate: 0.01 },
        { seq: 5, materialCode: '3309000090', materialName: '透明胶带', spec: '6cm*50m', unit: '卷', category: 'tape', basis: 'case', qtyPerBasis: 0.052, wasteRate: 0 },
        { seq: 6, materialCode: '3503000049', materialName: 'PET热封发泡透气垫片（单耳）-FoYes定制', spec: '110mm电镀银色盖-泉金（客供）', unit: '只', category: 'gasket', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.015, supplied: 'customer' },
        { seq: 7, materialCode: '3504000047', materialName: '1gal 紫色PET瓶-泉金（客供）', spec: 'LOGO垫片-客供', unit: '只', category: 'bottle', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.02, supplied: 'customer' }
    ]
}

// ── 示意 C：瓶/箱/托（6 瓶/箱、48 箱/托），批量 2000 瓶；含 2 行人工量（basis:'manual'）──
const BOM_PROTEIN = {
    productCode: '1306003626',
    productName: '真霸粉（巧克力口味）',
    packSpec: 'OP6K-1.36kg/瓶*6瓶/箱*48箱/托',
    batchPrefix: 'OP6K',
    bottlePerCase: 6,
    casePerPallet: 48,
    bottleWeightKg: 1.36,
    materials: [
        { seq: 1, materialCode: '1314000391-1', materialName: '真霸粉（巧克力口味）-混合', spec: 'OP6K', unit: '千克', category: 'powder', basis: 'bottle', qtyPerBasis: 1.36, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '3100003376', materialName: '标签-OP6K（3磅）', spec: '巧克力口味-368.3*139.7mm-日格TC58-5QS(亮银)', materialVersion: '01', unit: '只', category: 'label', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '3203022040', materialName: 'ON120mm黑色定制LOGO瓶盖', spec: '盖外径120.54±0.5mm/盖高23±0.5mm-PE易撕', unit: '只', category: 'cap', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.015 },
        { seq: 4, materialCode: '3204010181', materialName: 'ON1加仑黑色瓶-泉金', spec: '瓶直径152±1.5mm-瓶高251±2mm-标准容量3786ml', unit: '只', category: 'bottle', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.01 },
        { seq: 5, materialCode: '3209000184', materialName: 'ON8oz勺子-泉金', spec: '高度72±0.5mm-口部直径64.81±0.5mm', unit: '只', category: 'spoon', basis: 'bottle', qtyPerBasis: 1, wasteRate: 0.03 },
        { seq: 6, materialCode: '3302000209', materialName: '大衬板', spec: '1175*975mm', unit: '张', category: 'board', basis: 'manual', manualQty: 17 },
        { seq: 7, materialCode: '3302000978', materialName: '空白纸箱', spec: '468*314*267mm-A7A/A', unit: '只', category: 'case', basis: 'case', qtyPerBasis: 1, wasteRate: 0.01 },
        { seq: 8, materialCode: '3309000463', materialName: '木头托盘（国内用）', spec: '', unit: '只', category: 'pallet', basis: 'manual', manualQty: 9 }
    ]
}

// ── 示意 D：瓶/箱，批量 3000 瓶；用**新字段**（innerUnit/innerWeightKg/packLevels + basis:'inner'），验证新旧等效 ──
const BOM_APD9 = {
    productCode: '1306008141',
    productName: 'FoYes分离乳清蛋白粉（锡兰红茶味）',
    packSpec: 'APD9-FoYes-750g/瓶*6瓶/箱',
    batchPrefix: 'APD9',
    innerUnit: '瓶',
    innerWeightKg: 0.75,
    packLevels: [{ key: 'case', unit: '箱', per: 6 }],
    materials: [
        { seq: 1, materialCode: '1314001008-1', materialName: 'FoYes分离乳清蛋白粉（锡兰红茶味）-混合', spec: 'APD9', unit: '千克', category: 'powder', basis: 'inner', qtyPerBasis: 0.75, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '3100005120', materialName: '标签-KL26137-APD9', spec: '1.65磅-锡兰红茶味-478*130mm-亮银BOPP', materialVersion: '01', unit: '只', category: 'label', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '3209000229', materialName: '80cc勺子-独立包装（干机）', unit: '只', category: 'spoon', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 4, materialCode: '3302001351', materialName: '空白纸箱', spec: '494*332*230mm-A7K/C-印刷标志-倒角', unit: '只', category: 'case', basis: 'case', qtyPerBasis: 1, wasteRate: 0.01 },
        { seq: 5, materialCode: '3309000090', materialName: '透明胶带', spec: '6cm*50m', unit: '卷', category: 'tape', basis: 'case', qtyPerBasis: 0.052, wasteRate: 0 },
        { seq: 6, materialCode: '3503000049', materialName: 'PET热封发泡透气垫片（单耳）-FoYes定制', spec: '110mm电镀银色盖-泉金（客供）', unit: '只', category: 'gasket', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.015, supplied: 'customer' },
        { seq: 7, materialCode: '3504000047', materialName: '1gal 紫色PET瓶-泉金（客供）', spec: '瓶口容量3800+60mm-PET-瓶直径161.25±1.5mm-瓶高214.2±1.5mm', unit: '只', category: 'bottle', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.02, supplied: 'customer' },
        { seq: 8, materialCode: '3900000024', materialName: '空白唛头-K1', unit: '张', category: 'mark', basis: 'case', qtyPerBasis: 1, wasteRate: 0.02 }
    ]
}

// ── 示意 E：三级包装 条/盒/箱（内包「条」→ 中包装「盒」→ 外箱「箱」），批量 150000 条；基准首次出现 basis:'mid' ──
const BOM_APAN = {
    productCode: '1306007609',
    productName: '东方甄选蛋白粉',
    packSpec: 'APAN-10g/条*30条/盒*20盒/箱',
    batchPrefix: 'APAN',
    innerUnit: '条',
    innerWeightKg: 0.01,
    packLevels: [{ key: 'mid', unit: '盒', per: 30 }, { key: 'case', unit: '箱', per: 20 }],
    materials: [
        { seq: 1, materialCode: '', materialName: '粉料-混合', unit: '千克', category: 'powder', basis: 'inner', qtyPerBasis: 0.01, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '', materialName: '纸盒', unit: '只', category: 'carton', basis: 'mid', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '', materialName: '隔板', unit: '只', category: 'divider', basis: 'mid', qtyPerBasis: 1, wasteRate: 0 },
        { seq: 4, materialCode: '3302001002', materialName: '空白纸箱', unit: '只', category: 'case', basis: 'case', qtyPerBasis: 1, wasteRate: 0.01 }
    ]
}

// ── 用例 1：示意A 全部 8 行（自洽回归：期望值 = 公式按 fixture 参数算出的结果）──
test('示意A（瓶/箱/托）：8 行计划量自洽', () => {
    const r = computeBomByBottles(BOM_CREATINE, 21000)
    assert.strictEqual(r.cases, 21000 / 36)
    assert.strictEqual(r.pallets, (21000 / 36) / 64)
    assert.deepStrictEqual(r.rows.map(x => x.plannedQty), [
        4200,   // 粉料 21000 × 0.2
        21429,  // 标签 21000 ÷ 0.98
        21320,  // 瓶盖 21000 ÷ 0.985
        21320,  // 瓶
        21650,  // 勺子 21000 ÷ 0.97
        19,     // 衬板 (583.33÷64) × 2
        590,    // 纸箱 583.33 ÷ 0.99
        31      // 胶带 583.33 × 0.052
    ])
})

// ── 用例 2：示意B 全部 7 行 ──
test('示意B（瓶/箱，含客供件）：7 行计划量自洽', () => {
    const r = computeBomByBottles(BOM_WHEY, 4950)
    assert.strictEqual(r.cases, 825)
    assert.deepStrictEqual(r.rows.map(x => x.plannedQty), [
        3712.5, // 粉料 4950 × 0.75（不取整）
        5052,   // 标签 4950 ÷ 0.98
        5052,   // 勺子
        834,    // 纸箱 825 ÷ 0.99
        43,     // 胶带 825 × 0.052
        5026,   // 垫片 4950 ÷ 0.985
        5052    // 瓶 4950 ÷ 0.98
    ])
})

// ── 用例 3：示意C 全部 8 行（含 2 行人工量）──
test('示意C（含人工量行）：8 行计划量自洽', () => {
    const r = computeBomByBottles(BOM_PROTEIN, 2000)
    assert.strictEqual(r.cases, 2000 / 6)
    assert.deepStrictEqual(r.rows.map(x => x.plannedQty), [
        2720,   // 粉料 2000 × 1.36
        2041,   // 标签 2000 ÷ 0.98
        2031,   // 瓶盖 2000 ÷ 0.985
        2021,   // 瓶 2000 ÷ 0.99
        2062,   // 勺子 2000 ÷ 0.97
        17,     // 衬板 人工
        337,    // 纸箱 333.33 ÷ 0.99
        9       // 木托 人工
    ])
})

// ── 用例 4：示意D（新字段书写）8 行 —— 与旧字段写法等效 ──
test('示意D（新字段 inner/packLevels）：8 行计划量自洽', () => {
    const r = computeBomByBottles(BOM_APD9, 3000)
    assert.strictEqual(r.inner, 3000)
    assert.strictEqual(r.case, 500)
    assert.deepStrictEqual(r.rows.map(x => x.plannedQty), [
        2250,   // 粉料 3000 × 0.75
        3062,   // 标签 3000 ÷ 0.98
        3062,   // 勺子 3000 ÷ 0.98
        506,    // 纸箱 500 ÷ 0.99
        26,     // 胶带 500 × 0.052
        3046,   // 垫片 3000 ÷ 0.985
        3062,   // 瓶 3000 ÷ 0.98
        511     // 唛头 500 ÷ 0.98
    ])
})

// ── 用例 5：三级包装（条/盒/箱）—— 中包装基准 basis:'mid' 生效 ──
test('示意E（条/盒/箱三级包装）：4 行命中且中包装基准生效', () => {
    const r = computeBomByBottles(BOM_APAN, 150000)
    assert.strictEqual(r.inner, 150000)
    assert.strictEqual(r.mid, 5000)    // 150000 ÷ 30
    assert.strictEqual(r.case, 250)    // 5000 ÷ 20
    assert.strictEqual(r.pallet, 0)    // 无托级
    assert.deepStrictEqual(r.rows.map(x => x.plannedQty), [
        1500,   // 粉料 150000 × 0.01
        5103,   // 纸盒 5000 ÷ 0.98  ← 以「盒」为基准
        5000,   // 隔板 5000 × 1   ← 以「盒」为基准
        253     // 纸箱 250 ÷ 0.99 ← 以「箱」为基准
    ])
    // 层级换算自洽
    assert.deepStrictEqual(resolveLevelCounts(BOM_APAN.packLevels, 150000), { inner: 150000, mid: 5000, case: 250, pallet: 0 })
})

// ── 用例 6：损耗率必须逐行生效（同一批内 1% / 1.5% / 2% / 3% 并存）──
test('逐行损耗率：同批量下 4 种损耗各自算出不同结果', () => {
    const counts = { bottles: 21000, cases: 0, pallets: 0 }
    const q = loss => computeRowQty({ basis: 'bottle', qtyPerBasis: 1, wasteRate: loss }, counts)
    assert.strictEqual(q(0), 21000)
    assert.strictEqual(q(0.01), 21213)   // 21000 ÷ 0.99 = 21212.1
    assert.strictEqual(q(0.015), 21320)  // 21000 ÷ 0.985
    assert.strictEqual(q(0.02), 21429)   // 21000 ÷ 0.98
    assert.strictEqual(q(0.03), 21650)   // 21000 ÷ 0.97
})

// ── 用例 7：胶带系数 0.052 卷/箱 在多组参数下复现 ──
test('透明胶带 0.052 卷/箱：多组参数复现', () => {
    const tape = { basis: 'case', qtyPerBasis: 0.052, wasteRate: 0 }
    assert.strictEqual(computeRowQty(tape, { cases: 21000 / 36 }), 31)
    assert.strictEqual(computeRowQty(tape, { cases: 825 }), 43)
    assert.strictEqual(computeRowQty(tape, { cases: 250 }), 13)
    assert.strictEqual(computeRowQty(tape, { cases: 500 }), 26)
})

// ── 用例 8：取整与兜底 ──
test('取整方式与异常输入兜底', () => {
    // 默认 ceil
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 1.01 }, { bottles: 100 }), 101)
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 1.01, roundMode: 'floor' }, { bottles: 100 }), 101)
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 1.019, roundMode: 'round' }, { bottles: 100 }), 102)
    // none：按重量计的粉料不取整（4950 × 0.75 = 3712.50，不能变 3713）
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 0.75, roundMode: 'none' }, { bottles: 4950 }), 3712.5)
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 0.2, roundMode: 'none' }, { bottles: 21000 }), 4200)
    // 无基准数 / 无系数 → 0
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 1 }, { bottles: 0 }), 0)
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 0 }, { bottles: 100 }), 0)
    // 未知 basis → 0（不抛异常）
    assert.strictEqual(computeRowQty({ basis: 'unknown', qtyPerBasis: 1 }, { bottles: 100 }), 0)
    // 损耗率越界钳制：>=1 视为 0.99，负数视为 0
    assert.ok(computeRowQty({ basis: 'bottle', qtyPerBasis: 1, wasteRate: 5 }, { bottles: 100 }) > 0)
    assert.strictEqual(computeRowQty({ basis: 'bottle', qtyPerBasis: 1, wasteRate: -1 }, { bottles: 100 }), 100)
    // 空 BOM 不炸
    assert.deepStrictEqual(computeBom(null, {}).rows, [])
    assert.deepStrictEqual(computeBomByBottles({}, 100).rows, [])
    // basis 常量对外暴露（inner 与 bottle 等价；新增 mid 中包装）
    assert.deepStrictEqual(BOM_BASIS, ['inner', 'bottle', 'mid', 'case', 'pallet', 'manual'])
})

// ── 用例 9：按单位汇总 ──
test('按计量单位汇总小计', () => {
    const r = computeBomByBottles(BOM_CREATINE, 21000)
    assert.deepStrictEqual(sumBomByUnit(r.rows), {
        '千克': 4200, '只': 21429 + 21320 + 21320 + 21650 + 590, '张': 19, '卷': 31
    })
})

// ── 用例 10：包装规格解析（含三级与任意内包单位）──
test('包装规格解析：瓶/条 两种内包 + 多级', () => {
    // 瓶级二级
    const p1 = parsePackSpec('OP7F-200g/瓶*36瓶/箱*64箱/托')
    assert.strictEqual(p1.innerUnit, '瓶')
    assert.strictEqual(p1.innerWeightKg, 0.2)
    assert.deepStrictEqual(p1.levels, [{ key: 'case', unit: '箱', per: 36 }, { key: 'pallet', unit: '托', per: 64 }])
    assert.strictEqual(p1.bottleWeightKg, 0.2)
    assert.strictEqual(p1.bottlePerCase, 36)
    assert.strictEqual(p1.casePerPallet, 64)

    // 三级：条 → 盒 → 箱
    const p2 = parsePackSpec('APAN-10g/条*30条/盒*20盒/箱')
    assert.strictEqual(p2.innerUnit, '条')
    assert.strictEqual(p2.innerWeightKg, 0.01)
    assert.deepStrictEqual(p2.levels, [{ key: 'mid', unit: '盒', per: 30 }, { key: 'case', unit: '箱', per: 20 }])
    assert.strictEqual(p2.bottlePerCase, 0)   // 第一级是「盒」不是「箱」，故历史别名不给值
    assert.strictEqual(p2.casePerPallet, 0)

    // 1.36kg 不能被拆成 36g；750g 要折算 0.75
    assert.strictEqual(parsePackSpec('OP6K-1.36kg/瓶*6瓶/箱*48箱/托').innerWeightKg, 1.36)
    assert.strictEqual(parsePackSpec('APD8-FoYes-750g/瓶*6瓶/箱').innerWeightKg, 0.75)
    const p3 = parsePackSpec('APD9-FoYes-750g/瓶*6瓶/箱')
    assert.strictEqual(p3.innerUnit, '瓶')
    assert.deepStrictEqual(p3.levels, [{ key: 'case', unit: '箱', per: 6 }])

    // 无法解析时全 0/空，不抛异常
    const none = parsePackSpec('')
    assert.strictEqual(none.innerUnit, '')
    assert.strictEqual(none.innerWeightKg, 0)
    assert.deepStrictEqual(none.levels, [])
    assert.strictEqual(parsePackSpec('随便写点什么').bottlePerCase, 0)
})

// ── 用例 11：批号匹配（替代 product-data.js 的硬编码 exactBatch）──
test('按批号前缀匹配 BOM', () => {
    const boms = [BOM_CREATINE, BOM_WHEY, BOM_PROTEIN, BOM_APD9, BOM_APAN]
    assert.strictEqual(matchBomByBatch(boms, 'OP7F26X1019').productCode, '1306003790')
    assert.strictEqual(matchBomByBatch(boms, 'apd826x1004').productCode, '1306008137')  // 小写也认
    assert.strictEqual(matchBomByBatch(boms, 'OP6K26X1009').productCode, '1306003626')
    assert.strictEqual(matchBomByBatch(boms, 'APD926X1001').productCode, '1306008141')
    assert.strictEqual(matchBomByBatch(boms, 'APAN26X1001').productCode, '1306007609')
    assert.strictEqual(matchBomByBatch(boms, 'XXXX26X1009'), null)   // 无匹配
    // 同前缀多份 → 歧义，返回 null 而不是随便挑一个
    const dup = [BOM_CREATINE, Object.assign({}, BOM_CREATINE, { productCode: '9999999999' })]
    assert.strictEqual(matchBomByBatch(dup, 'OP7F26X1019'), null)
    // 停用的不参与匹配
    const off = [Object.assign({}, BOM_CREATINE, { enabled: false })]
    assert.strictEqual(matchBomByBatch(off, 'OP7F26X1019'), null)
    assert.strictEqual(matchBomByBatch(boms, ''), null)
})

// ── 用例 12：新旧字段等价（历史 bottle/bottles 与 inner/packLevels 结果一致）──
test('新旧字段等价：bottle/bottles 与 inner/packLevels 同结果', () => {
    const legacy = computeBomByBottles(BOM_WHEY, 4950)          // bottlePerCase=6 / basis:'bottle'
    const modern = computeBomByBottles(BOM_APD9, 3000)          // packLevels / basis:'inner'
    assert.strictEqual(legacy.rows[0].plannedQty, 3712.5)
    assert.strictEqual(modern.rows[0].plannedQty, 2250)
    // levelsFromBom：旧文档只有 bottlePerCase/casePerPallet 也能合成层级
    assert.deepStrictEqual(levelsFromBom(BOM_WHEY), [{ key: 'case', unit: '箱', per: 6 }])
    assert.deepStrictEqual(levelsFromBom(BOM_CREATINE), [{ key: 'case', unit: '箱', per: 36 }, { key: 'pallet', unit: '托', per: 64 }])
    // 新文档优先用 packLevels
    assert.deepStrictEqual(levelsFromBom(BOM_APAN), BOM_APAN.packLevels)
})

// ── 用例 13：包装规格解析出的每箱瓶数与 fixture 设定一致（自洽性）──
test('包装规格解析出的每箱瓶数与 fixture 设定一致', () => {
    assert.strictEqual(parsePackSpec(BOM_CREATINE.packSpec).bottlePerCase, BOM_CREATINE.bottlePerCase)
    assert.strictEqual(parsePackSpec(BOM_PROTEIN.packSpec).casePerPallet, BOM_PROTEIN.casePerPallet)
    const parsed = parsePackSpec(BOM_CREATINE.packSpec)
    const merged = Object.assign({}, BOM_CREATINE, { packLevels: parsed.levels })
    assert.strictEqual(computeBomByBottles(merged, 21000).rows[6].plannedQty, 590)
    // 示意E 解析结果能直接驱动计算
    const p = parsePackSpec(BOM_APAN.packSpec)
    const merged2 = Object.assign({}, BOM_APAN, { packLevels: p.levels })
    assert.strictEqual(computeBomByBottles(merged2, 150000).mid, 5000)
})

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
