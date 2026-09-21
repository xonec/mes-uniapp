'use strict'

// 云函数：product-materials
// 用途：product_materials 集合（产品物料清单档案）的受控读写入口。
//   数据模型：单产品单文档，_id 固定为 "mat:<产品编码>"，客户端不直连数据库。
//   只记录「产品用什么物料」（编号/名称/规格型号/版本号/计量单位），不做用量与损耗计算
//  —— 需要按批量算计划量请用 product_bom / product-bom。
//
//   action = 'get'    ：按产品编码读一份清单
//   action = 'list'   ：列出清单（默认只列 enabled!==false，投影精简字段，不含 materials）
//   action = 'upsert' ：幂等写入/更新一份清单（同产品编码始终同一 _id）
//
// 读取需登录；写入按 product-bom 同样口径需登录（如需收紧为管理员，把 checkAuth 换成 checkAdmin 即可）。
// 依赖公共模块 mes-common（token 校验 / 鉴权 / 响应封装）；密钥从环境变量 MES_TOKEN_SECRET 读取。

const { checkAuth, ok, fail } = require('mes-common')

const COLL = 'product_materials'
const MAX_MATERIALS = 200

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃（无法被 try/catch 捕获）
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

function docId(productCode) {
    return 'mat:' + String(productCode)
}

function str(v, max) {
    const s = v === undefined || v === null ? '' : String(v).trim()
    return max && s.length > max ? s.slice(0, max) : s
}

function num(v, dflt) {
    const n = Number(v)
    return Number.isFinite(n) ? n : (dflt === undefined ? 0 : dflt)
}

// 产品编码：非空、去空格、禁含 ':'（避免与 _id 前缀混淆）
function normalizeProductCode(v) {
    const s = str(v)
    if (!s) throw new Error('产品编码缺失')
    if (s.indexOf(':') >= 0) throw new Error('产品编码非法：不能含冒号')
    if (s.length > 40) throw new Error('产品编码过长')
    return s
}

function normalizeMaterials(v) {
    if (!Array.isArray(v)) return []
    if (v.length > MAX_MATERIALS) throw new Error('物料行数超过上限 ' + MAX_MATERIALS)
    return v.map((row, i) => {
        row = row || {}
        const materialCode = str(row.materialCode, 40)
        if (!materialCode) throw new Error('第 ' + (i + 1) + ' 行物料编号缺失')
        const unit = str(row.unit, 12)
        if (!unit) throw new Error('第 ' + (i + 1) + ' 行计量单位缺失')
        return {
            seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : i + 1,
            materialCode,
            materialName: str(row.materialName, 120),
            spec: str(row.spec, 200),
            materialVersion: str(row.materialVersion, 20) || 'N/A',
            unit
        }
    })
}

// 归一化整份档案：入参 = 客户端传来的 record 对象（或直接是文档）
function normalizeRecord(input) {
    if (!input || typeof input !== 'object') throw new Error('record 缺失或格式错误')
    const productCode = normalizeProductCode(input.productCode)
    const materials = normalizeMaterials(input.materials)
    if (!materials.length) throw new Error('物料清单为空（materials 至少 1 行）')
    return {
        productCode,
        productName: str(input.productName, 120),
        packSpec: str(input.packSpec, 120),
        materials,
        sourceOrderNo: str(input.sourceOrderNo, 40),
        source: ['manual', 'import', 'photo'].indexOf(str(input.source)) >= 0 ? str(input.source) : 'manual',
        enabled: input.enabled === false ? false : true
    }
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
            const limit = Math.min(500, Math.max(1, num(event.limit, 100)))
            const res = await db.collection(COLL).limit(limit).get()
            // 显式挑字段返回（不把整份 materials 传给列表页），同时给出 materialCount
            const rows = (((res || {}).data) || []).filter(r => r.enabled !== false).map(r => ({
                productCode: r.productCode,
                productName: r.productName,
                packSpec: r.packSpec,
                sourceOrderNo: r.sourceOrderNo || '',
                materialCount: Array.isArray(r.materials) ? r.materials.length : 0,
                updatedAt: r.updatedAt || 0
            }))
            return ok(rows)
        }

        if (action === 'upsert') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const doc = normalizeRecord(event.record)
            doc.updatedAt = Date.now()
            doc.updatedBy = auth.uid
            const id = docId(doc.productCode)
            await upsertDoc(id, doc)
            return ok({ _id: id, productCode: doc.productCode, materialCount: doc.materials.length })
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[product-materials] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '内部错误: ' + ((e && (e.message || e.errMsg)) || JSON.stringify(e)))
    }
}
