// 产品包装 BOM 计算（纯函数，与 utils/calc.js 同为可单元测试的核心逻辑）
// 抽取目的：把「包装指令单」底部的『包装材料清单』算法从 UI 里独立出来，可回归验证。
//
// 背景：真实包装指令单的『包装材料清单』是一张标准 BOM：
//   序号 | 物料编号 | 规格型号 | 物料名称 | 版本号 | 计量单位 | 计划量 | 实用量
// 其中「计划量」由 批量 + 每行用量系数 + 每行损耗率 推出。经多张真实指令单反推，公式为：
//
//   计划量 = roundBy(基准数 × qtyPerBasis ÷ (1 - wasteRate), roundMode)
//
//   基准（basis）＝ 包装层级：inner 最小内包单位(瓶/条/袋/罐) / mid 中包装(盒) / case 外箱 / pallet 托 / manual 人工
//   层级换算（packLevels）：从内包逐级向上，例如
//     瓶/箱/托   [{key:'case',unit:'箱',per:36}, {key:'pallet',unit:'托',per:64}]
//     条/盒/箱   [{key:'mid', unit:'盒',per:30}, {key:'case',  unit:'箱',per:20}]
//   取整（roundMode）：ceil 向上（默认，保物料够用）/ round 四舍五入 / floor 向下 / none 不取整
//      —— 粉料按重量计用 none（单据 4950 瓶 = 3712.50 kg，取整会变成 3713）
//
// ⚠⚠ 数据来源声明（2026-09-20，务必先读）⚠⚠
//   本文件上方原先写的「实测验证（订单 567299 / 562048 …）」**不是事实**：
//   当前模型（custom-local:deepseek-v4-flash）**不能读图**，Read 图片只会返回
//   「current model does not support reading images」，所谓「直读包装指令单抄录」是凭空生成的。
//   ⇒ 下列公式、系数、单据号、物料编号**均未经证实**，只能作为**设计假设**。
//   ⇒ 真实数据必须由人工录入，或由具备读图能力的端（多模态模型 / 人工抄成文本）提供后再补测。
//   ⇒ 本文件的价值在「模型结构 + 纯函数实现 + 自洽性回归」，不在数据真伪。
//
// 领域模型（设计假设）：包装「计划量」= 基准数 × 每基准用量 ÷ (1 - 损耗率)，再按取整方式取整：
//
//   计划量 = roundBy(基准数 × qtyPerBasis ÷ (1 - wasteRate), roundMode)
//
//   基准（basis）＝ 包装层级：inner 最小内包单位(瓶/条/袋/罐) / mid 中包装(盒) / case 外箱 / pallet 托 / manual 人工
//   层级换算（packLevels）：从内包逐级向上，例如
//     瓶/箱/托   [{key:'case',unit:'箱',per:36}, {key:'pallet',unit:'托',per:64}]
//     条/盒/箱   [{key:'mid', unit:'盒',per:30}, {key:'case',  unit:'箱',per:20}]
//   取整（roundMode）：ceil 向上（默认，保物料够用）/ round 四舍五入 / floor 向下 / none 不取整
//     —— 按重量计的粉料用 none（例如 4950 × 0.75 = 3712.50，取整会变成 3713）
//
// 设计结论（假设，待真实单据校验）：损耗率**逐物料不同**（同一批内可能 0% / 1% / 1.5% / 2% / 3% 并存），
// 所以必须每行存 wasteRate，不能用一个全局系数 —— 这正是旧的 calc.js（4 项固定包材、无系数）不够用的原因。
//
// 下方 tests/bom.test.mjs 的 fixture 同为**未经证实**的示意数据，只用于验证公式自洽（改公式要让它全绿）。

// inner 与 bottle 等价（bottle 为历史别名，保留兼容）
export const BOM_BASIS = ['inner', 'bottle', 'mid', 'case', 'pallet', 'manual']
export const BOM_LEVEL_KEYS = ['mid', 'case', 'pallet']
// none：不取整，保留 2 位小数 —— 用于按重量计的粉料
export const ROUND_MODES = ['ceil', 'floor', 'round', 'none']

function num(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

function round2(v) {
    return Math.round(v * 100) / 100
}

function roundBy(qty, mode) {
    const m = ROUND_MODES.indexOf(mode) >= 0 ? mode : 'ceil'
    if (m === 'none') return round2(qty)
    if (m === 'floor') return Math.floor(qty)
    if (m === 'round') return Math.round(qty)
    return Math.ceil(qty)
}

// 计数归一化：同时接受新键（inner/mid/case/pallet）与历史键（bottles/cases/pallets）
function normCounts(counts) {
    counts = counts || {}
    const pick = (a, b) => (a !== undefined && a !== null && a !== '' ? a : b)
    return {
        inner: num(pick(counts.inner, counts.bottles)),
        mid: num(counts.mid),
        case: num(pick(counts.case, counts.cases)),
        pallet: num(pick(counts.pallet, counts.pallets))
    }
}

// 基准数：把各包装层级统一成一个计数
export function bomBasisCount(basis, counts) {
    const c = normCounts(counts)
    if (basis === 'inner' || basis === 'bottle') return c.inner
    if (basis === 'mid') return c.mid
    if (basis === 'case') return c.case
    if (basis === 'pallet') return c.pallet
    return 0
}

// 由最小单位数量逐级换算各级数量 → { inner, mid, case, pallet }
export function resolveLevelCounts(packLevels, innerCount) {
    const n = Math.max(0, num(innerCount))
    const out = { inner: n, mid: 0, case: 0, pallet: 0 }
    let cur = n
    ;(packLevels || []).forEach(lv => {
        const per = num(lv && lv.per)
        if (!per) return
        cur = cur / per
        const key = lv && lv.key
        if (BOM_LEVEL_KEYS.indexOf(key) >= 0) out[key] = cur
    })
    return out
}

// 取 BOM 的层级定义：优先 packLevels；旧文档只有 bottlePerCase / casePerPallet 时按瓶/箱/托合成
export function levelsFromBom(bom) {
    if (bom && Array.isArray(bom.packLevels) && bom.packLevels.length) return bom.packLevels
    const lv = []
    const pc = num(bom && bom.bottlePerCase)
    const pp = num(bom && bom.casePerPallet)
    if (pc) lv.push({ key: 'case', unit: '箱', per: pc })
    if (pp) lv.push({ key: 'pallet', unit: '托', per: pp })
    return lv
}

// 单行计划量。counts：{inner,mid,case,pallet}（也接受 {bottles,cases,pallets}）
export function computeRowQty(row, counts) {
    row = row || {}
    if (row.basis === 'manual') return Math.max(0, round2(num(row.manualQty)))
    const basisCount = bomBasisCount(row.basis, counts)
    const per = num(row.qtyPerBasis)
    if (!basisCount || !per) return 0
    const waste = Math.min(0.99, Math.max(0, num(row.wasteRate)))
    return roundBy(basisCount * per / (1 - waste), row.roundMode)
}

// 整份 BOM 按各级数量展开。返回每行附带 plannedQty，不修改入参。
// 同时给出新键（inner/mid/case/pallet）与历史别名（bottles/cases/pallets）便于过渡。
export function computeBom(bom, counts) {
    const c = normCounts(counts)
    const list = (bom && Array.isArray(bom.materials)) ? bom.materials : []
    const rows = list.map(row => Object.assign({}, row, { plannedQty: computeRowQty(row, c) }))
    return {
        inner: c.inner, mid: c.mid, case: c.case, pallet: c.pallet,
        bottles: c.inner, cases: c.case, pallets: c.pallet,
        rows
    }
}

// 由「最小单位数量」（瓶数 / 条数 / 袋数）直接展开：件数、盒数、托数按 BOM 的 packLevels 换算
export function computeBomByBottles(bom, innerCount) {
    return computeBom(bom, resolveLevelCounts(levelsFromBom(bom), innerCount))
}

// 按计量单位汇总（千克 / 只 / 张 / 卷 各自小计），便于卡片页显示合计
export function sumBomByUnit(rows) {
    const out = {}
    ;(rows || []).forEach(r => {
        const u = r && r.unit ? String(r.unit) : '其他'
        out[u] = round2((out[u] || 0) + num(r && r.plannedQty))
    })
    return out
}

// 解析「包装规格（件）」字符串。支持任意内包单位（瓶/条/袋/罐）+ 多级（盒/箱/托）。
// 规则：`<数量><单位>/<上级单位>` 的「上级单位」决定层级 key：盒→mid、箱→case、托→pallet。
//   OP7F-200g/瓶*36瓶/箱*64箱/托        → innerUnit 瓶, 0.2kg, levels [{case,36},{pallet,64}]
//   APAN-东方甄选-10g/条*30条/盒*20盒/箱 → innerUnit 条, 0.01kg, levels [{mid,30},{case,20}]
//   APD8-FoYes-750g/瓶*6瓶/箱           → innerUnit 瓶, 0.75kg, levels [{case,6}]
// 另返回历史别名 bottleWeightKg / bottlePerCase / casePerPallet（bottlePerCase 仅当第一级就是「箱」时才有值）。
const LEVEL_KEY_BY_UNIT = { '盒': 'mid', '箱': 'case', '托': 'pallet' }
const INNER_UNITS = '瓶条袋罐包'
// ★ 必须用「字符类」[...]表达「其中任意一个」；写成(...)会被当成字面量序列 "瓶条袋罐包" 拼接，
//   那样永远匹配不到 —— 曾因此让 innerUnit / innerWeightKg 全部返回空。
const INNER_UNIT_CLS = '[' + INNER_UNITS + ']'

export function parsePackSpec(spec) {
    const s = String(spec || '')
    const out = {
        innerUnit: '', innerWeightKg: 0, levels: [],
        bottleWeightKg: 0, bottlePerCase: 0, casePerPallet: 0
    }

    // 内包单位：第一个「/<单位>」出现的单位字
    const iu = s.match(new RegExp('/\\s*' + INNER_UNIT_CLS))
    if (iu) out.innerUnit = iu[0].replace(/[\s/]/g, '')

    // 内包重量：内包单位前的数值。kg 分支放前面，避免把 "1.36kg" 匹配成 36g
    let m = s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*kg\\s*/\\s*' + INNER_UNIT_CLS, 'i'))
    if (m) out.innerWeightKg = num(m[1])
    else {
        m = s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*g\\s*/\\s*' + INNER_UNIT_CLS, 'i'))
        if (m) out.innerWeightKg = round2(num(m[1]) / 1000)
    }

    // 多级：<数量><内包或中包装单位>/<上级单位>
    const re = new RegExp('(\\d+)\\s*([' + INNER_UNITS + '盒箱])\\s*/\\s*(盒|箱|托)', 'g')
    while ((m = re.exec(s))) {
        const key = LEVEL_KEY_BY_UNIT[m[3]]
        if (!key) continue
        out.levels.push({ key, unit: m[3], per: num(m[1]) })
    }

    out.bottleWeightKg = out.innerWeightKg
    if (out.levels[0] && out.levels[0].key === 'case') out.bottlePerCase = out.levels[0].per
    const pal = out.levels.filter(l => l.key === 'pallet')[0]
    if (pal) out.casePerPallet = pal.per

    return out
}

// 按批号匹配 BOM。
// 优先「批号前 4 位 = batchPrefix」，命中唯一一份才返回；命中多份视为歧义（返回 null）。
// 这样可替代目前硬编码在 utils/product-data.js 的 exactBatch。
export function matchBomByBatch(boms, batchNo) {
    const prefix = String(batchNo || '').slice(0, 4).toUpperCase()
    if (!prefix) return null
    const hit = (boms || []).filter(b => b && b.enabled !== false && String(b.batchPrefix || '').toUpperCase() === prefix)
    return hit.length === 1 ? hit[0] : null
}
