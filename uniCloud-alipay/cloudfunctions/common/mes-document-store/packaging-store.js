'use strict'
const { randomBytes } = require('crypto')
const { ClientError } = require('mes-common')
const { addImmutable, validateSourceReference } = require('./source-store')
const { text, basePackSpec, normalizePallet, actorName, changes } = require('./trace-fields')

/** 保存客户档案，名称调整也保留历史版本。 */
async function saveCustomer(db, input, uid, expectedVersion) {
    input = input || {}
    const id = text(input._id, 80) || 'customer:' + randomBytes(16).toString('hex')
    if (!/^customer:[a-f0-9]{32}$/.test(id)) throw new ClientError('客户标识非法', 400)
    const name = text(input.name, 120)
    if (!name) throw new ClientError('请输入客户名称', 400)
    const store = require('./index'), label = await actorName(db, uid), record = { name, externalCode: text(input.externalCode, 80), note: text(input.note, 2000), enabled: input.enabled !== false }
    const reason = text(input.changeReason, 1000)
    const result = await store.saveVersioned(db, { collection: 'mes_customers', versions: 'mes_customer_versions', keyField: 'customerId', key: id, id, record, uid, expectedVersion,
        signature: doc => store.stableKey(Object.fromEntries(Object.keys(record).map(key => [key, doc[key]]))),
        authorizeChange: old => { if (old && expectedVersion === undefined) throw new ClientError('请重新加载客户后保存', 409); if (old && !reason && Object.keys(record).some(key => store.stableKey(old[key]) !== store.stableKey(record[key]))) throw new ClientError('修改客户请填写原因', 400) },
        audit: (old, version) => ({ actorId: uid, actorName: label, at: Date.now(), reason: reason || '首次建立客户', version, previousVersion: old ? old.version : 0 }) })
    return result
}
/** 从已发布的方案记录恢复不可变版本；历史版本材料和上托要求不受当前方案编辑影响。 */
async function ensurePlanVersion(db, plan, version) {
    if (!Array.isArray(plan.materials)) plan = ((await db.collection('packaging_plans').doc(plan._id).get()).data || [])[0]
    const versionId = 'planv:' + plan._id.slice(5) + ':' + version
    const existing = ((await db.collection('packaging_plan_versions').doc(versionId).get()).data || [])[0]
    if (existing) return existing
    let snapshot = plan
    if (Number(plan.version) !== Number(version)) {
        const history = ((await db.collection('packaging_plan_history').doc('ver:' + plan._id + ':' + version).get()).data || [])[0]
        if (!history || !history.snapshot) throw new ClientError('包装方案版本不存在', 404)
        snapshot = history.snapshot
    }
    return addImmutable(db, 'packaging_plan_versions', { ...snapshot, _id: versionId, planId: plan._id, planVersionId: versionId })
}
/** 保存客户包装方案；多个方案可以同时存在，内容变化产生新版本。 */
async function savePlan(db, input, uid, expectedVersion) {
    input = input || {}
    const store = require('./index')
    const productCode = text(input.productCode, 40)
    const id = text(input._id, 80) || 'plan:' + randomBytes(16).toString('hex')
    if (!/^plan:[a-f0-9]{32}$/.test(id) || !/^\d{10}$/.test(productCode)) throw new ClientError('方案或产品编码非法', 400)
    const customer = ((await db.collection('mes_customers').doc(text(input.customerId, 80)).get()).data || [])[0]
    if (!customer) throw new ClientError('请先建立并选择客户', 400)
    const product = ((await db.collection('product_materials').doc('mat:' + productCode).get()).data || [])[0]
    if (!product) throw new ClientError('请先建立产品档案', 400)
    const record = { productCode, productName: product.productName, packSpec: basePackSpec(product.packSpec), customerId: customer._id, customerName: customer.name,
        planName: text(input.planName, 120), materials: store.normalizeMaterials(input.materials), pallet: normalizePallet(input.pallet || {}),
        packingRequirements: text(input.packingRequirements, 10000), sourceDocumentId: text(input.sourceDocumentId, 120), recognitionRunId: text(input.recognitionRunId, 80), enabled: input.enabled !== false }
    if (!record.planName) throw new ClientError('请输入包装方案名称', 400)
    record.materialCount = record.materials.length
    const source = await validateSourceReference(db, record.sourceDocumentId, record.recognitionRunId, uid, true)
    if (source && record.materials.some(row => row.sourcePages.some(page => page > source.pages.length))) throw new ClientError('方案物料来源页超过原图页数', 400)
    const reason = text(input.changeReason, 1000), label = await actorName(db, uid)
    const signature = doc => store.stableKey(Object.fromEntries(Object.keys(record).map(field => [field, doc[field]])))
    const result = await store.saveVersioned(db, { collection: 'packaging_plans', versions: 'packaging_plan_history', keyField: 'planId', key: id, id, record, uid, expectedVersion, signature,
        authorizeChange: old => {
            if (!old && (customer.enabled === false || product.enabled === false)) throw new ClientError('停用的客户或产品不能建立新方案', 400)
            if (old && expectedVersion === undefined) throw new ClientError('请重新加载包装方案后保存', 409)
            if (old && (old.customerId !== record.customerId || old.productCode !== record.productCode)) throw new ClientError('方案的客户和产品不能修改，请新建另一份方案', 400)
            if (old && signature(old) !== signature(record) && !reason) throw new ClientError('修改包装方案请填写原因', 400)
        }, audit: (old, version) => ({ actorId: uid, actorName: label, at: Date.now(), reason: reason || '首次建立包装方案', version, previousVersion: old ? old.version : 0, changedFields: changes(old, record, store.stableKey).map(item => item.field) }) })
    const current = ((await db.collection('packaging_plans').doc(id).get()).data || [])[0]
    const published = await ensurePlanVersion(db, current, result.version)
    return { ...result, planVersionId: published._id }
}
/** 列出所选产品和客户的全部启用方案；不按产品编码自动选最后一份。 */
async function listPlans(db, event) {
    if (event.productCode && !/^\d{10}$/.test(String(event.productCode))) throw new ClientError('筛选产品编码须为10位数字', 400)
    const condition = { ...(event.productCode ? { productCode: text(event.productCode, 10) } : {}), ...(event.customerId ? { customerId: text(event.customerId, 80) } : {}), ...(event.includeDisabled ? {} : { enabled: db.command.neq(false) }) }
    const plans = (await db.collection('packaging_plans').where(condition).orderBy('updatedAt', 'desc').limit(200)
        .field({ productCode: true, productName: true, packSpec: true, customerId: true, customerName: true, planName: true, version: true, updatedAt: true, enabled: true, materialCount: true, pallet: true }).get()).data || []
    return plans.map(plan => ({ ...plan, planVersionId: 'planv:' + plan._id.slice(5) + ':' + (Number(plan.version) || 1) }))
}
/** 获取方案历史版本列表，用于订单选择指定版本。 */
async function planVersions(db, id) {
    if (!/^plan:[a-f0-9]{32}$/.test(String(id || ''))) throw new ClientError('包装方案标识非法', 400)
    const plan = ((await db.collection('packaging_plans').doc(id).get()).data || [])[0]
    if (!plan) throw new ClientError('包装方案不存在', 404)
    await ensurePlanVersion(db, plan, Number(plan.version) || 1)
    return (await db.collection('packaging_plan_versions').where({ planId: id }).orderBy('version', 'desc').limit(200).field({ planId: true, planVersionId: true, version: true, planName: true, updatedAt: true, audit: true }).get()).data || []
}
/** 只返回已发布的方案版本，供订单明确选择及方案历史查看。 */
async function getPlanVersion(db, versionId) {
    if (!/^planv:[a-f0-9]{32}:\d+$/.test(String(versionId || ''))) throw new ClientError('包装方案版本标识非法', 400)
    const version = ((await db.collection('packaging_plan_versions').doc(versionId).get()).data || [])[0]
    if (version) return version
    const parts = versionId.split(':')
    const current = ((await db.collection('packaging_plans').doc('plan:' + parts[1]).get()).data || [])[0]
    if (!current) throw new ClientError('包装方案版本不存在', 404)
    return ensurePlanVersion(db, current, Number(parts[2]))
}
module.exports = { saveCustomer, savePlan, listPlans, planVersions, ensurePlanVersion, getPlanVersion }
