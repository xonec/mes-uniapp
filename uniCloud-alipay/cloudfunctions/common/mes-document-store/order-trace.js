'use strict'
const { ClientError, batchIsValid } = require('mes-common')
const { addImmutable, validateSourceReference, sourceDetail } = require('./source-store')
const { text, basePackSpec, normalizePallet, actorName, changes } = require('./trace-fields')
const { syncOrderBom } = require('./bom-store')

/** 获取订单当前记录，固定订单号主键。 */
async function currentOrder(db, orderNo) { return ((await db.collection('production_orders').doc('order:' + orderNo).get()).data || [])[0] || null }
/** 维护完整批号到订单的唯一关联，旧批号关联作为纠错追溯入口保留。 */
async function reserveBatch(db, batchNo, orderNo, uid) {
    const existing = (await db.collection('production_orders').where({ batchNo }).limit(2).get()).data || []
    if (existing.some(order => order.orderNo !== orderNo)) throw new ClientError('此完整批号已关联其他订单，请核对', 409)
    const link = await addImmutable(db, 'production_batch_orders', { _id: 'batch:' + batchNo, batchNo, orderNo, createdAt: Date.now(), createdBy: uid })
    if (link.orderNo !== orderNo) throw new ClientError('此完整批号已关联其他订单，不能重复使用', 409)
}
/** 保存订单实际采用的材料、方案版本和上托配置；审计信息完全由服务端生成。 */
async function saveTracedOrder(db, input, uid, expectedVersion, isAdmin, store) {
    const record = store.normalizeOrder(input)
    const old = await currentOrder(db, record.orderNo)
    if (old && expectedVersion === undefined) throw new ClientError('更新订单须带当前版本，请重新加载后保存', 409)
    if (expectedVersion !== undefined && expectedVersion !== (old ? Number(old.version) || 1 : 0)) throw new ClientError('订单已被修改，请重新加载后核对', 409)
    const preserve = field => Object.prototype.hasOwnProperty.call(input, field) ? input[field] : old && old[field]
    // 计划起止时间：App 不传时保留旧值（或 null），显式传 null 才清空。
    record.planStartAt = store.normalizePlanTime(preserve('planStartAt'), '计划开始时间')
    record.planEndAt = store.normalizePlanTime(preserve('planEndAt'), '计划结束时间')
    if (record.planStartAt !== null && record.planEndAt !== null && record.planEndAt <= record.planStartAt) throw new ClientError('计划结束时间须晚于计划开始时间', 400)
    record.rawPackSpec = text(input.rawPackSpec || input.packSpec, 500)
    record.packSpec = basePackSpec(input.packSpec)
    const product = ((await db.collection('product_materials').doc('mat:' + record.productCode).get()).data || [])[0]
    const specKey = value => basePackSpec(value).replace(/\s+/g, '').replace(/[×xX]/g, '*')
    if (product && specKey(product.packSpec) !== specKey(record.packSpec) && !(old && old.productCode === record.productCode && old.packSpec === record.packSpec)) throw new ClientError('该产品包装规格固定，请载入产品基本信息后核对；原单规格会保留在来源凭据中', 409)
    record.plannedQtyRaw = text(input.plannedQtyRaw !== undefined && Number(input.plannedQtyRaw) === record.plannedQty ? input.plannedQtyRaw : input.plannedQty, 50)
    record.sampleCount = text(input.sampleCount, 2000)
    record.packingBatchNo = text(preserve('packingBatchNo'), 40).toUpperCase()
    if (record.packingBatchNo && !batchIsValid(record.packingBatchNo)) throw new ClientError('包装批号须为11 位字母数字或其后的 B 单后缀', 400)
    if (record.packingBatchNo === record.batchNo) record.packingBatchNo = ''
    record.orderStatus = ['draft', 'confirmed'].includes(preserve('orderStatus')) ? preserve('orderStatus') : 'draft'
    record.customerId = text(preserve('customerId'), 80)
    record.customerName = ''
    if (record.customerId) {
        const customer = ((await db.collection('mes_customers').doc(record.customerId).get()).data || [])[0]
        if (!customer || (customer.enabled === false && (!old || old.customerId !== customer._id))) throw new ClientError('客户不存在或已停用，请重新选择', 400)
        record.customerName = customer.name
    }
    record.sourceDocumentId = text(preserve('sourceDocumentId'), 120)
    record.recognitionRunId = text(preserve('recognitionRunId'), 80)
    const source = await validateSourceReference(db, record.sourceDocumentId, record.recognitionRunId, uid, isAdmin || !!(old && old.sourceDocumentId === record.sourceDocumentId && old.recognitionRunId === record.recognitionRunId))
    if (source && record.materials.some(row => row.sourcePages.some(page => page > source.pages.length))) throw new ClientError('物料来源页超过原始单据页数', 400)
    record.sourceType = source ? source.textOnly ? 'text' : 'photo' : 'manual'
    record.planVersionId = text(preserve('planVersionId'), 100)
    record.planId = ''; record.planName = ''; record.planVersion = null
    let plan = null
    if (record.planVersionId) {
        plan = ((await db.collection('packaging_plan_versions').doc(record.planVersionId).get()).data || [])[0]
        if (!plan || plan.productCode !== record.productCode || plan.customerId !== record.customerId) throw new ClientError('包装方案版本与产品、客户不一致，请重新选择', 400)
        const currentPlan = ((await db.collection('packaging_plans').doc(plan.planId).get()).data || [])[0]
        if ((!currentPlan || currentPlan.enabled === false) && (!old || old.planVersionId !== record.planVersionId)) throw new ClientError('包装方案已停用，请选择启用方案', 400)
        record.planId = plan.planId; record.planName = plan.planName; record.planVersion = plan.version
    }
    const palletInput = Object.prototype.hasOwnProperty.call(input, 'pallet') ? input.pallet : old && old.pallet || plan && plan.pallet || {}
    record.pallet = normalizePallet(palletInput || {})
    if (record.orderStatus === 'confirmed' && (!record.customerId || !record.productName || !record.packSpec || !record.materials.length)) throw new ClientError('正式确认订单前，请选择客户并核对产品信息和材料清单；上托要求可后补', 400)
    record.packagingSnapshot = { productCode: record.productCode, productName: record.productName, packSpec: record.packSpec, materials: record.materials, pallet: record.pallet, customerId: record.customerId, customerName: record.customerName, planVersionId: record.planVersionId, planName: record.planName, planVersion: record.planVersion }
    const comparable = doc => store.stableKey(Object.fromEntries(Object.keys(record).map(field => [field, doc[field] === undefined ? null : doc[field]])))
    const reason = text(input.changeReason, 1000)
    const changed = !old || comparable(old) !== comparable(record)
    if (old && changed && !reason) throw new ClientError('修改订单请填写原因，便于追溯', 400)
    const name = await actorName(db, uid)
    await reserveBatch(db, record.batchNo, record.orderNo, uid)
    const result = await store.saveVersioned(db, {
        collection: 'production_orders', versions: 'production_order_versions', keyField: 'orderNo', key: record.orderNo, id: 'order:' + record.orderNo,
        record, uid, expectedVersion, signature: comparable,
        authorizeChange: previous => store.authorizeEnabledChange(previous, record, isAdmin, '订单'),
        audit: (previous, version) => ({ actorId: uid, actorName: name, at: Date.now(), reason: reason || '首次录入', action: previous ? 'update' : 'create', previousVersion: previous ? Number(previous.version) || 1 : 0, version, changedFields: changes(previous, record, store.stableKey).map(item => item.field) })
    })
    // 订单保存成功后自动同步 BOM；BOM 失败不阻塞订单保存，只在返回里标记原因。
    let bom
    try { bom = await syncOrderBom(db, record, uid) }
    catch (error) {
        console.warn('[order-trace] BOM 自动同步失败：' + String((error && (error.message || error.errMsg)) || error).slice(0, 160))
        bom = { action: 'failed', error: String((error && (error.message || error.errMsg)) || 'BOM 同步失败').slice(0, 200) }
    }
    return { ...result, orderNo: record.orderNo, bom }
}
/** 获取指定订单版本，历史版本只读。 */
async function orderVersion(db, current, version) {
    if (!version || Number(version) === (Number(current.version) || 1)) return current
    const requested = Number(version)
    if (!Number.isInteger(requested) || requested < 1) throw new ClientError('订单版本非法', 400)
    const item = ((await db.collection('production_order_versions').doc('ver:' + current.orderNo + ':' + requested).get()).data || [])[0]
    if (!item || !item.snapshot) throw new ClientError('订单历史版本不存在', 404)
    return item.snapshot
}
/** 通过完整批号或订单号查看原图、所选版本、方案及操作历史。 */
async function traceOrder(db, event, uid) {
    let orderNo = text(event.orderNo, 12), batchNo = text(event.batchNo, 40).toUpperCase()
    if (!orderNo) {
        if (!batchIsValid(batchNo)) throw new ClientError('请输入完整生产批号（含 B 单后缀）', 400)
        const linked = ((await db.collection('production_batch_orders').doc('batch:' + batchNo).get()).data || [])[0]
        if (linked) orderNo = linked.orderNo
        else {
            const rows = (await db.collection('production_orders').where({ batchNo }).limit(2).get()).data || []
            if (rows.length > 1) throw new ClientError('早期数据中此批号关联多个订单，请先核对并修正', 409)
            if (rows[0]) orderNo = rows[0].orderNo
        }
    }
    if (!/^\d{4,12}$/.test(orderNo)) throw new ClientError('未找到此批号关联的订单', 404)
    const current = await currentOrder(db, orderNo)
    if (!current) throw new ClientError('订单不存在', 404)
    const page = Math.max(1, Math.floor(Number(event.page) || 1)), pageSize = 20
    const historical = await db.collection('production_order_versions').where({ orderNo }).orderBy('version', 'desc').skip((page - 1) * pageSize).limit(pageSize + 1)
        .field({ version: true, savedAt: true, updatedBy: true, 'snapshot.audit': true, 'snapshot.batchNo': true, 'snapshot.orderStatus': true, 'snapshot.pallet.status': true }).get()
    let selected = await orderVersion(db, current, event.version)
    if (batchNo && !event.version && selected.batchNo !== batchNo) {
        const matching = (await db.collection('production_order_versions').where({ orderNo, 'snapshot.batchNo': batchNo }).orderBy('version', 'desc').limit(1).get()).data || []
        if (!matching[0]) throw new ClientError('此批号没有已保存订单版本，请核对', 404)
        selected = matching[0].snapshot
    }
    const selectedVersion = Number(selected.version) || 1
    let previous = null
    if (selectedVersion > 1) {
        try { previous = await orderVersion(db, current, selectedVersion - 1) }
        catch (error) { if (!(error instanceof ClientError) || error.code !== 404) throw error }
    }
    const source = selected.sourceDocumentId ? await sourceDetail(db, selected.sourceDocumentId, selected.recognitionRunId, uid, true) : null
    const plan = selected.planVersionId ? ((await db.collection('packaging_plan_versions').doc(selected.planVersionId).get()).data || [])[0] || null : null
    const store = require('./index')
    const versions = (historical.data || []).slice(0, pageSize).map(item => ({ version: item.version, batchNo: item.snapshot && item.snapshot.batchNo || '', at: item.snapshot && item.snapshot.audit && item.snapshot.audit.at || item.savedAt, audit: item.snapshot && item.snapshot.audit || { actorId: item.updatedBy, reason: '早期版本未记录修改原因' } }))
    if (page === 1) versions.unshift({ version: Number(current.version) || 1, batchNo: current.batchNo, at: current.audit && current.audit.at || current.updatedAt, audit: current.audit || { actorId: current.updatedBy || current.savedBy, reason: '早期记录未记录修改原因' } })
    const records = (await db.collection('production_records').where({ batchNo: selected.batchNo }).limit(20).field({ batchNo: true, version: true, updatedAt: true, savedAt: true, savedBy: true, orderNo: true, orderVersion: true, planVersionId: true, audit: true }).get()).data || []
    const recordHistory = (await db.collection('production_record_versions').where({ batchNo: selected.batchNo, 'snapshot.orderNo': orderNo, 'snapshot.orderVersion': selectedVersion }).orderBy('version', 'desc').limit(20)
        .field({ batchNo: true, version: true, savedAt: true, 'snapshot.orderNo': true, 'snapshot.orderVersion': true, 'snapshot.audit': true }).get()).data || []
    const related = [...records.filter(record => !record.orderVersion || (record.orderNo === orderNo && record.orderVersion === selectedVersion)), ...recordHistory.map(item => ({ ...item, orderNo: item.snapshot.orderNo, orderVersion: item.snapshot.orderVersion, audit: item.snapshot.audit, historical: true, snapshot: undefined }))]
    return { order: selected, currentVersion: Number(current.version) || 1, versions, page, hasMore: (historical.data || []).length > pageSize, source, plan, changes: previous ? changes(previous, selected, store.stableKey).filter(item => item.field !== 'packagingSnapshot') : [], records: related }
}
module.exports = { saveTracedOrder, traceOrder, currentOrder }

/** 生产计算按完整批号查当前订单，不使用批号前缀猜产品或方案。 */
async function getOrderByBatch(db, batchNo) {
    const code = text(batchNo, 40).toUpperCase()
    if (!batchIsValid(code)) throw new ClientError('批号须为11 位字母数字或其后的 B 单后缀', 400)
    const rows = (await db.collection('production_orders').where({ batchNo: code }).limit(2).get()).data || []
    if (rows.length > 1) throw new ClientError('此批号关联多个早期订单，请管理员先核对', 409)
    return rows[0] || null
}
module.exports.getOrderByBatch = getOrderByBatch
module.exports.orderVersion = orderVersion
