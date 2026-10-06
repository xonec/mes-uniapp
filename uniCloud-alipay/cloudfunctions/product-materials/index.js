'use strict'

// 云函数：product-materials
// 用途：product_materials 集合（产品物料清单档案）的受控读写入口。
//   数据模型：单产品单文档，_id 固定为 "mat:<产品编码>"，客户端不直连数据库。
//   只记录「产品用什么物料」（编号/名称/规格型号/版本号/计量单位），不做用量与损耗计算
//  —— 需要按批量算计划量请用 product_bom / product-bom。
//
//   action = 'get'         ：按产品编码读一份清单
//   action = 'list'        ：列出清单（默认只列 enabled!==false，投影精简字段，不含 materials）
//   action = 'upsert'      ：幂等写入/更新一份清单（同产品编码始终同一 _id）；
//                            每次内容变更自动在 product_materials_versions 留历史快照，便于追溯
//   action = 'listVersions'：列出某产品编码的历史版本（version 倒序），每条含当时完整 snapshot
//
// 读写需登录；管理列表及启用/停用状态变更需要管理员。
// 依赖 mes-common（uni-id 鉴权）和 mes-document-store（版本与管理查询）。

const { checkAuth, checkAdmin, ok, fail, ClientError } = require('mes-common')
const { saveVersioned, listDocuments, stableKey, authorizeEnabledChange } = require('mes-document-store')
const { sourcePages, basePackSpec, actorName } = require('mes-document-store/trace-fields')
const { validateSourceReference } = require('mes-document-store/source-store')

const COLL = 'product_materials'
const VERSION_COLL = 'product_materials_versions'
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
    if (!s) throw new ClientError('产品编码缺失')
    if (s.indexOf(':') >= 0) throw new ClientError('产品编码非法：不能含冒号')
    if (s.length > 40) throw new ClientError('产品编码过长')
    if (!/^\d{10}$/.test(s)) throw new ClientError('产品编码须为 10 位数字', 400)
    return s
}

function normalizeMaterials(v) {
    if (!Array.isArray(v)) return []
    if (v.length > MAX_MATERIALS) throw new ClientError('物料行数超过上限 ' + MAX_MATERIALS)
    return v.map((row, i) => {
        row = row || {}
        const materialCode = str(row.materialCode, 40)
        if (!materialCode) throw new ClientError('第 ' + (i + 1) + ' 行物料编号缺失')
        const unit = str(row.unit, 12)
        if (!unit) throw new ClientError('第 ' + (i + 1) + ' 行计量单位缺失')
        return {
            seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : i + 1,
            materialCode,
            materialName: str(row.materialName, 120),
            spec: str(row.spec, 2000),
            materialVersion: str(row.materialVersion, 20) || null,
            unit, sourcePages: sourcePages(row.sourcePages)
        }
    })
}

// 归一化整份档案：入参 = 客户端传来的 record 对象（或直接是文档）
function normalizeRecord(input) {
    if (!input || typeof input !== 'object') throw new ClientError('record 缺失或格式错误')
    const productCode = normalizeProductCode(input.productCode)
    const materials = normalizeMaterials(input.materials)
    if (!materials.length) throw new ClientError('物料清单为空（materials 至少 1 行）')
    return {
        productCode,
        productName: str(input.productName, 120),
        packSpec: basePackSpec(input.packSpec),
        materials,
        sourceOrderNo: str(input.sourceOrderNo, 40),
        sourceDocumentId: str(input.sourceDocumentId, 120), recognitionRunId: str(input.recognitionRunId, 80),
        source: ['manual', 'import', 'photo'].indexOf(str(input.source)) >= 0 ? str(input.source) : 'manual',
        enabled: input.enabled === false ? false : true
    }
}

// 内容签名：仅取影响追溯的关键字段；相同签名视为无变化，不刷版本（避免相同照片重扫刷屏）
function signature(d) {
    if (!d || typeof d !== 'object') return ''
    return stableKey({ productName: d.productName || '', packSpec: d.packSpec || '', enabled: d.enabled !== false, materials: d.materials || [], sourceOrderNo: d.sourceOrderNo || '', sourceDocumentId: d.sourceDocumentId || '', recognitionRunId: d.recognitionRunId || '' })
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
            return ok(rows.length ? { ...rows[0], version: Number(rows[0].version) || 1 } : null)
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
            const id = docId(doc.productCode)
            const reason = str(event.record.changeReason, 1000), label = await actorName(db, auth.uid)
            const previous = ((await db.collection(COLL).doc(id).get()).data || [])[0]
            const sameSource = !!(previous && previous.sourceDocumentId === doc.sourceDocumentId && previous.recognitionRunId === doc.recognitionRunId)
            const source = await validateSourceReference(db, doc.sourceDocumentId, doc.recognitionRunId, auth.uid, (auth.role || []).includes('admin') || sameSource)
            if (source && doc.materials.some(row => row.sourcePages.some(page => page > source.pages.length))) throw new ClientError('物料来源页超过原图页数', 400)

            const result = await saveVersioned(db, {
                collection: COLL, versions: VERSION_COLL, keyField: 'productCode', key: doc.productCode,
                id, record: doc, uid: auth.uid, expectedVersion: event.expectedVersion, signature,
                authorizeChange: old => {
                    authorizeEnabledChange(old, doc, (auth.role || []).includes('admin'), '产品')
                    if (old && event.expectedVersion === undefined) throw new ClientError('更新产品须带当前版本，请重新加载', 409)
                    if (old && signature(old) !== signature(doc) && !reason) throw new ClientError('修改产品物料请填写原因', 400)
                },
                audit: (old, version) => ({ actorId: auth.uid, actorName: label, at: Date.now(), reason: reason || '首次建立产品档案', version, previousVersion: old ? Number(old.version) || 1 : 0 })
            })
            return ok({ ...result, productCode: doc.productCode, materialCount: doc.materials.length })
        }

        if (action === 'adminList') {
            const auth = await checkAdmin(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const result = await listDocuments(db, COLL, event, ['productCode', 'productName', 'packSpec'], {
                productCode: true, productName: true, packSpec: true, materials: true,
                enabled: true, version: true, updatedAt: true
            })
            result.list = result.list.map(({ materials, ...row }) => ({ ...row,
                version: Number(row.version) || 1, materialCount: Array.isArray(materials) ? materials.length : 0
            }))
            return ok(result)
        }

        if (action === 'setEnabled') {
            const auth = await checkAdmin(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            if (typeof event.enabled !== 'boolean') return fail(400, '启用状态非法')
            const code = normalizeProductCode(event.productCode)
            const rows = (await db.collection(COLL).doc(docId(code)).get()).data || []
            if (!rows.length) return fail(404, '产品不存在')
            const doc = normalizeRecord({ ...rows[0], enabled: event.enabled })
            const label = await actorName(db, auth.uid)
            return ok(await saveVersioned(db, {
                collection: COLL, versions: VERSION_COLL, keyField: 'productCode', key: code,
                id: docId(code), record: doc, uid: auth.uid, expectedVersion: event.expectedVersion, signature,
                audit: (old, version) => ({ actorId: auth.uid, actorName: label, at: Date.now(), reason: event.enabled ? '后台启用产品' : '后台停用产品', version, previousVersion: Number(old.version) || 1 })
            }))
        }

        if (action === 'listVersions') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const code = normalizeProductCode(event.productCode)
            const limit = Math.min(200, Math.max(1, num(event.limit, 50)))
            let rows = []
            try {
                const res = await db.collection(VERSION_COLL).where({ productCode: code }).orderBy('version', 'desc').limit(limit).get()
                rows = ((res || {}).data || [])
            } catch (e) { rows = [] }
            const out = rows.map(r => ({
                version: r.version,
                savedAt: r.savedAt || '',
                updatedBy: r.updatedBy || '',
                snapshot: r.snapshot || null
            }))
            return ok(out)
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        if (e && e.name === 'ClientError') return fail(e.code || 500, e.message)
        console.error('[product-materials] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
