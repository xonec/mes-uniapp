'use strict'

// 云函数：product-bom
// 用途：product_bom 集合（产品包装 BOM／包装指令单底部的『包装材料清单』）的受控读写入口。
//   数据模型：单产品单文档，_id 固定为 "bom:<产品编码>"，客户端不直连数据库。
//
//   action = 'get'          ：按产品编码读一份 BOM
//   action = 'list'         ：列出 BOM（默认只列 enabled!==false，可按 batchPrefix 过滤，投影精简字段）
//   action = 'matchByBatch' ：按批号前 4 位（batchPrefix）匹配；命中唯一一份才返回，多份视为歧义
//   action = 'upsert'       ：幂等写入/更新一份 BOM（同产品编码始终同一 _id）
//
// 读取需登录；写入按 batch-buckets 同样口径需登录（如需收紧为管理员，把 checkAuth 换成 checkAdmin 即可）。
// 依赖公共模块 mes-common（token 校验 / 鉴权 / 响应封装 / ClientError）；密钥从环境变量 MES_TOKEN_SECRET 读取。

const { checkAuth, ok, fail, ClientError } = require('mes-common')

const COLL = 'product_bom'
const BASIS = ['inner', 'bottle', 'mid', 'case', 'pallet', 'manual']
const LEVEL_KEYS = ['mid', 'case', 'pallet']
const ROUND_MODES = ['ceil', 'floor', 'round', 'none']
const MAX_MATERIALS = 200

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃（无法被 try/catch 捕获）
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

function docId(productCode) {
    return 'bom:' + String(productCode)
}

function str(v, max) {
    const s = v === undefined || v === null ? '' : String(v).trim()
    return max && s.length > max ? s.slice(0, max) : s
}

function num(v, dflt) {
    const n = Number(v)
    return Number.isFinite(n) ? n : (dflt === undefined ? 0 : dflt)
}

function clampWaste(v) {
    const n = num(v)
    if (n < 0) return 0
    if (n >= 1) return 0.99
    return n
}

// 产品编码：非空、去空格、禁含 ':'（避免与 _id 前缀混淆）
function normalizeProductCode(v) {
    const s = str(v)
    if (!s) throw new ClientError('产品编码缺失')
    if (s.indexOf(':') >= 0) throw new ClientError('产品编码非法：不能含冒号')
    if (s.length > 40) throw new ClientError('产品编码过长')
    return s
}

// 批号前缀：取前 4 位大写；BOM 未填时由批号前缀兜底
function normalizeBatchPrefix(v, batchNo) {
    const s = str(v).toUpperCase() || str(batchNo).slice(0, 4).toUpperCase()
    return s.slice(0, 10)
}

// 包装层级 [{key,unit,per}]，key: mid 盒 / case 箱 / pallet 托
function normalizeLevels(v) {
    if (!Array.isArray(v)) return []
    const out = []
    v.forEach(lv => {
        if (!lv || typeof lv !== 'object') return
        const key = str(lv.key).toLowerCase()
        if (LEVEL_KEYS.indexOf(key) < 0) return
        const per = num(lv.per)
        if (per <= 0) return
        out.push({ key, unit: str(lv.unit) || (key === 'mid' ? '盒' : key === 'case' ? '箱' : '托'), per })
    })
    return out
}

function normalizeMaterials(v) {
    if (!Array.isArray(v)) return []
    if (v.length > MAX_MATERIALS) throw new ClientError('物料行数超过上限 ' + MAX_MATERIALS)
    return v.map((row, i) => {
        row = row || {}
        const basis = str(row.basis).toLowerCase()
        if (BASIS.indexOf(basis) < 0) throw new ClientError('第 ' + (i + 1) + ' 行 basis 非法：' + basis)
        const roundMode = str(row.roundMode).toLowerCase()
        const r = {
            seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : i + 1,
            materialCode: str(row.materialCode, 40),
            materialName: str(row.materialName, 120),
            spec: str(row.spec, 200),
            materialVersion: str(row.materialVersion, 20) || 'N/A',
            unit: str(row.unit, 12),
            category: str(row.category, 20) || 'other',
            basis,
            qtyPerBasis: num(row.qtyPerBasis),
            wasteRate: clampWaste(row.wasteRate),
            roundMode: ROUND_MODES.indexOf(roundMode) >= 0 ? roundMode : 'ceil'
        }
        if (basis === 'manual') r.manualQty = Math.max(0, num(row.manualQty))
        if (row.supplied) r.supplied = str(row.supplied, 20)
        return r
    })
}

// 归一化整份 BOM：入参 = 客户端传来的 bom 对象（或直接是文档）
function normalizeBom(input) {
    if (!input || typeof input !== 'object') throw new ClientError('bom 缺失或格式错误')
    const productCode = normalizeProductCode(input.productCode)
    const packLevels = normalizeLevels(input.packLevels)
    const materials = normalizeMaterials(input.materials)
    if (!materials.length) throw new ClientError('物料清单为空（materials 至少 1 行）')

    // 历史别名：packLevels 缺省时由 bottlePerCase / casePerPallet 合成
    let levels = packLevels
    if (!levels.length) {
        const pc = num(input.bottlePerCase)
        const pp = num(input.casePerPallet)
        if (pc > 0) levels.push({ key: 'case', unit: '箱', per: pc })
        if (pp > 0) levels.push({ key: 'pallet', unit: '托', per: pp })
    }

    const innerWeightKg = num(input.innerWeightKg, num(input.bottleWeightKg))
    const doc = {
        productCode,
        productName: str(input.productName, 120),
        packSpec: str(input.packSpec, 120),
        batchPrefix: normalizeBatchPrefix(input.batchPrefix, input.batchNo),
        innerUnit: str(input.innerUnit, 4),
        innerWeightKg,
        packLevels: levels,
        // 历史别名同步落库，兼容尚未升级的老客户端
        bottleWeightKg: innerWeightKg,
        bottlePerCase: levels[0] && levels[0].key === 'case' ? levels[0].per : num(input.bottlePerCase),
        casePerPallet: num(input.casePerPallet) || (levels.filter(l => l.key === 'pallet')[0] || {}).per || 0,
        materials,
        enabled: input.enabled === false ? false : true,
        source: ['manual', 'import', 'photo'].indexOf(str(input.source)) >= 0 ? str(input.source) : 'manual',
        note: str(input.note, 300)
    }
    return doc
}

// 归一化 update() 返回的实际更新条数（不同云厂商 / SDK 版本字段名不同，逐个兼容）
function updatedCount(r) {
    if (!r) return 0
    const cands = [
        r.updated, r.affectedDocs,
        r.result && r.result.updated, r.result && r.result.affectedDocs,
        r.res && r.res.updated, r.res && r.res.affectedDocs,
        r.stats && r.stats.updated,
        r.data && r.data.updated, r.data && r.data.affectedDocs
    ]
    for (const v of cands) {
        if (typeof v === 'number' && v > 0) return v
    }
    return 0
}

async function upsertDoc(id, data) {
    const coll = db.collection(COLL)
    try {
        await coll.doc(id).set(data)
        return
    } catch (e) { /* 回退 */ }

    let updated = 0
    try {
        updated = updatedCount(await coll.doc(id).update(data))
    } catch (e) { updated = 0 }
    if (updated) return

    try {
        await coll.add(Object.assign({}, data, { _id: id }))
    } catch (e) {
        const msg = String((e && (e.message || e.errMsg)) || e)
        if (/duplicate|exist|already/i.test(msg)) {
            await coll.doc(id).update(data)
        } else {
            throw e
        }
    }
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        db = getDb()

        if (action === 'get') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const code = normalizeProductCode(event.productCode)
            const rows = ((await db.collection(COLL).doc(docId(code)).get()) || {}).data || []
            return ok(rows.length ? rows[0] : null)
        }

        if (action === 'list') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const where = {}
            const prefix = str(event.batchPrefix).toUpperCase()
            if (prefix) where.batchPrefix = prefix
            const limit = Math.min(500, Math.max(1, num(event.limit, 100)))
            const res = await db.collection(COLL).where(where).limit(limit).get()
            // 显式挑字段返回（不把整份 materials 传给列表页），同时给出 materialCount
            const rows = (((res || {}).data) || []).filter(r => r.enabled !== false).map(r => ({
                productCode: r.productCode,
                productName: r.productName,
                packSpec: r.packSpec,
                batchPrefix: r.batchPrefix,
                innerUnit: r.innerUnit,
                innerWeightKg: r.innerWeightKg,
                packLevels: r.packLevels || [],
                bottlePerCase: r.bottlePerCase || 0,
                casePerPallet: r.casePerPallet || 0,
                materialCount: Array.isArray(r.materials) ? r.materials.length : 0,
                updatedAt: r.updatedAt || 0
            }))
            return ok(rows)
        }

        if (action === 'matchByBatch') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const batchNo = str(event.batchNo).toUpperCase()
            const prefix = batchNo.slice(0, 4)
            if (!prefix) return ok({ bom: null, ambiguous: false, count: 0 })
            const res = await db.collection(COLL).where({ batchPrefix: prefix }).get()
            const hit = (((res || {}).data) || []).filter(b => b && b.enabled !== false)
            if (hit.length === 1) return ok({ bom: hit[0], ambiguous: false, count: 1 })
            return ok({ bom: null, ambiguous: hit.length > 1, count: hit.length })
        }

        if (action === 'upsert') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const doc = normalizeBom(event.bom)
            doc.updatedAt = Date.now()
            doc.updatedBy = auth.uid
            const id = docId(doc.productCode)
            await upsertDoc(id, doc)
            return ok({ _id: id, productCode: doc.productCode, materialCount: doc.materials.length })
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        if (e && e.name === 'ClientError') return fail(e.code || 500, e.message)
        console.error('[product-bom] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
