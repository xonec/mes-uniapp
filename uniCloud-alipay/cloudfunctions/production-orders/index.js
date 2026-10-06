'use strict'
const { checkAuth, checkAdmin, ok, fail, ClientError } = require('mes-common')
const { listDocuments, saveOrder } = require('mes-document-store')
const { traceOrder, getOrderByBatch } = require('mes-document-store/order-trace')
const { saveCustomer, savePlan, listPlans, planVersions, getPlanVersion } = require('mes-document-store/packaging-store')
const { prepareSourceImages, commitSourceImages, cleanupSourceUploads, sourceDetail } = require('mes-document-store/source-store')
const COLL = 'production_orders'

exports.main = async event => {
    event = event || {}
    try {
        const db = uniCloud.database()
        const action = event.action
        const auth = await (['list', 'upsert', 'setEnabled', 'trace', 'sourceDetail', 'saveCustomer', 'savePlan'].includes(action) ? checkAdmin : checkAuth)(db, event.uniIdToken)
        if (auth.errCode) return fail(auth.errCode, auth.message)
        if (action === 'getByBatch') return ok(await getOrderByBatch(db, event.batchNo))
        if (action === 'trace') return ok(await traceOrder(db, event, auth.uid))
        if (action === 'sourceDetail') return ok(await sourceDetail(db, event.sourceDocumentId, event.recognitionRunId, auth.uid, true))
        if (action === 'prepareSourceImages') return ok(await prepareSourceImages(db, event.sourceDocumentId, auth.uid))
        if (action === 'commitSourceImages') return ok(await commitSourceImages(db, event, auth.uid))
        if (action === 'cleanupSourceUploads') return ok(await cleanupSourceUploads(db, event, auth.uid))
        if (action === 'listCustomers') return ok((await db.collection('mes_customers').where(event.includeDisabled && (auth.role || []).includes('admin') ? {} : { enabled: db.command.neq(false) }).orderBy('name', 'asc').limit(500).get()).data || [])
        if (action === 'saveCustomer') return ok(await saveCustomer(db, event.record, auth.uid, event.expectedVersion))
        if (action === 'listPlans') return ok(await listPlans(db, { ...event, includeDisabled: event.includeDisabled === true && (auth.role || []).includes('admin') }))
        if (action === 'planVersions') return ok(await planVersions(db, event.planId))
        if (action === 'getPlanVersion') return ok(await getPlanVersion(db, event.planVersionId))
        if (action === 'savePlan') return ok(await savePlan(db, event.record, auth.uid, event.expectedVersion))
        if (action === 'list') return ok(await listDocuments(db, COLL, event, ['orderNo', 'batchNo', 'productCode', 'productName'], {
            orderNo: true, batchNo: true, productCode: true, productName: true, packSpec: true,
            plannedQty: true, sampleCount: true, updatedAt: true, savedAt: true, version: true, enabled: true,
            orderStatus: true, customerName: true, 'pallet.status': true, planName: true
        }))
        if (action === 'get' || action === 'setEnabled') {
            const orderNo = String(event.orderNo || '').trim()
            if (!/^\d{4,12}$/.test(orderNo)) return fail(400, '订单号非法')
            const rows = (await db.collection(COLL).doc('order:' + orderNo).get()).data || []
            const record = rows[0] || null
            if (action === 'get') return ok(record ? { ...record, version: Number(record.version) || 1 } : null)
            if (!record) return fail(404, '订单不存在')
            if (typeof event.enabled !== 'boolean') return fail(400, '启用状态非法')
            return ok(await saveOrder(db, { ...record, enabled: event.enabled, changeReason: event.changeReason || (event.enabled ? '后台启用订单' : '后台停用订单') }, auth.uid, event.expectedVersion, true))
        }
        if (action === 'save' || action === 'upsert') return ok(await saveOrder(db, event.record, auth.uid, event.expectedVersion, (auth.role || []).includes('admin')))
        return fail(400, '未知 action')
    } catch (error) {
        if (error instanceof ClientError) return fail(error.code, error.message)
        console.error('[production-orders]', error.message)
        return fail(500, '订单保存或查询失败，请稍后重试')
    }
}
