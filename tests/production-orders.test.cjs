// 生产订单后台列表 + 计划起止时间（甘特）测试。
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createMemoryDb } = require('./helpers/memory-db.cjs')
const root = path.join(__dirname, '../uniCloud-alipay/cloudfunctions')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (/^mes-document-store(?:\/|$)/.test(request)) {
        const suffix = request === 'mes-document-store' ? 'index.js' : request.slice('mes-document-store/'.length) + '.js'
        return path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-document-store', suffix)
    }
    if (request === 'uni-id-common') return path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
    if (['mes-common', 'mes-document-store', 'order-parser', 'ocr-config'].includes(request)) return path.join(root, 'common', request, 'index.js')
    return resolve.call(this, request, ...args)
}
const db = createMemoryDb()
global.uniCloud = { database: () => db }
const orders = require(path.join(root, 'production-orders/index.js'))
const invoke = (action, data = {}, uid = 'admin') => orders.main({ action, uniIdToken: 'tok-' + uid, ...data })
const baseOrder = orderNo => ({
    orderNo, productCode: '1306008056', productName: '乳清蛋白粉', packSpec: '1.8kg/瓶*4瓶/箱',
    batchNo: 'APDD26X1006', plannedQty: 250, sampleCount: '7',
    materials: [{ seq: 1, materialCode: '1314001002-1', materialName: '混合粉料', spec: 'APDD', materialVersion: 'N/A', unit: '千克' }]
})
const PLAN_START = Date.UTC(2026, 0, 5, 8, 0, 0)
const PLAN_END = Date.UTC(2026, 0, 10, 18, 0, 0)
const dateOf = (iso) => Date.parse(iso)
function reset() {
    db.store.clear(); db.failWrite = null
    db.ensure('uni-id-users').set('u1', { _id: 'u1', status: 0, role: [] })
    db.ensure('uni-id-users').set('admin', { _id: 'admin', status: 0, role: ['admin'] })
}
let failed = 0, passed = 0
async function test(name, fn) {
    reset()
    try { await fn(); passed++; console.log('✓ ' + name) }
    catch (error) { failed++; console.error('✗ ' + name + '\n' + error.stack) }
}
function seedOrders(rows) {
    for (const row of rows) db.ensure('production_orders').set(row._id || ('order:' + row.orderNo), { enabled: true, version: 1, materials: [], ...row })
}
;(async () => {
    await test('保存计划开始/结束时间并可从列表读回', async () => {
        const record = { ...baseOrder('559290'), planStartAt: PLAN_START, planEndAt: PLAN_END }
        assert.equal((await invoke('save', { record, expectedVersion: 0 })).code, 0)
        const doc = db.ensure('production_orders').get('order:559290')
        assert.equal(doc.planStartAt, PLAN_START)
        assert.equal(doc.planEndAt, PLAN_END)
        const list = await invoke('list', { keyword: '559290' })
        assert.equal(list.code, 0)
        assert.equal(list.data.list[0].planStartAt, PLAN_START)
        assert.equal(list.data.list[0].planEndAt, PLAN_END)
        // 更新时不传计划时间应保留旧值（App 行为）
        assert.equal((await invoke('upsert', { record: { ...baseOrder('559290'), plannedQty: 251, changeReason: '改产量' }, expectedVersion: 1 })).code, 0)
        assert.equal(db.ensure('production_orders').get('order:559290').planStartAt, PLAN_START)
    })
    await test('只填开始时间也允许保存', async () => {
        const record = { ...baseOrder('559291'), planStartAt: PLAN_START }
        assert.equal((await invoke('save', { record, expectedVersion: 0 })).code, 0)
        const doc = db.ensure('production_orders').get('order:559291')
        assert.equal(doc.planStartAt, PLAN_START)
        assert.equal(doc.planEndAt, null)
    })
    await test('结束时间早于或等于开始时间被拒', async () => {
        const record = { ...baseOrder('559292'), planStartAt: PLAN_END, planEndAt: PLAN_START }
        const result = await invoke('save', { record, expectedVersion: 0 })
        assert.equal(result.code, 400)
        assert.match(result.message, /计划结束时间/)
        const equal = { ...baseOrder('559293'), planStartAt: PLAN_START, planEndAt: PLAN_START }
        assert.equal((await invoke('save', { record: equal, expectedVersion: 0 })).code, 400)
    })
    await test('显式传 null 可清空计划时间', async () => {
        assert.equal((await invoke('save', { record: { ...baseOrder('559294'), planStartAt: PLAN_START, planEndAt: PLAN_END }, expectedVersion: 0 })).code, 0)
        assert.equal((await invoke('upsert', { record: { ...baseOrder('559294'), planStartAt: null, planEndAt: null, changeReason: '清空计划时间' }, expectedVersion: 1 })).code, 0)
        const doc = db.ensure('production_orders').get('order:559294')
        assert.equal(doc.planStartAt, null)
        assert.equal(doc.planEndAt, null)
    })
    await test('超出 2020-01-01 ~ 2035-12-31 被拒', async () => {
        const early = await invoke('save', { record: { ...baseOrder('559295'), planStartAt: dateOf('2019-12-31T23:59:59.999Z') }, expectedVersion: 0 })
        assert.equal(early.code, 400)
        assert.match(early.message, /2020-01-01/)
        const late = await invoke('save', { record: { ...baseOrder('559296'), planEndAt: dateOf('2036-01-01T00:00:00.000Z') }, expectedVersion: 0 })
        assert.equal(late.code, 400)
        assert.match(late.message, /2035-12-31/)
    })
    await test('列表返回甘特所需字段', async () => {
        assert.equal((await invoke('save', { record: { ...baseOrder('559297'), planStartAt: PLAN_START, planEndAt: PLAN_END }, expectedVersion: 0 })).code, 0)
        const list = await invoke('list', { keyword: '559297' })
        const item = list.data.list[0]
        for (const field of ['orderStatus', 'planStartAt', 'planEndAt', 'updatedAt', 'customerName', 'planName']) {
            assert.ok(Object.prototype.hasOwnProperty.call(item, field), '缺少字段 ' + field)
        }
    })
    await test('pageSize 上限 200，201 被拒', async () => {
        seedOrders(Array.from({ length: 205 }, (_, index) => ({ orderNo: '56' + String(1000 + index), orderStatus: index % 2 ? 'draft' : 'confirmed', updatedAt: 1700000000000 + index })))
        const okPage = await invoke('list', { pageSize: 200 })
        assert.equal(okPage.code, 0)
        assert.equal(okPage.data.pageSize, 200)
        assert.equal(okPage.data.list.length, 200)
        assert.equal(okPage.data.total, 205)
        const tooLarge = await invoke('list', { pageSize: 201 })
        assert.equal(tooLarge.code, 400)
        assert.match(tooLarge.message, /200/)
    })
    await test('orderStatus 三种取值过滤正确', async () => {
        seedOrders([
            { orderNo: '561001', orderStatus: 'draft', updatedAt: 1 },
            { orderNo: '561002', orderStatus: 'draft', updatedAt: 2 },
            { orderNo: '561003', orderStatus: 'draft', updatedAt: 3 },
            { orderNo: '561004', orderStatus: 'confirmed', updatedAt: 4 },
            { orderNo: '561005', orderStatus: 'confirmed', updatedAt: 5 }
        ])
        assert.equal((await invoke('list', { orderStatus: 'draft' })).data.total, 3)
        assert.equal((await invoke('list', { orderStatus: 'confirmed' })).data.total, 2)
        assert.equal((await invoke('list', { orderStatus: 'all' })).data.total, 5)
        assert.equal((await invoke('list', {})).data.total, 5)
        const invalid = await invoke('list', { orderStatus: 'unknown' })
        assert.equal(invalid.code, 400)
        assert.match(invalid.message, /draft/)
    })
    await test('updatedFrom/updatedTo 含边界且允许只传一个', async () => {
        seedOrders([
            { orderNo: '562001', orderStatus: 'draft', updatedAt: 1000 },
            { orderNo: '562002', orderStatus: 'draft', updatedAt: 2000 },
            { orderNo: '562003', orderStatus: 'draft', updatedAt: 3000 }
        ])
        assert.equal((await invoke('list', { updatedFrom: 2000, updatedTo: 2000 })).data.total, 1)
        assert.equal((await invoke('list', { updatedFrom: 2000 })).data.total, 2)
        assert.equal((await invoke('list', { updatedTo: 2000 })).data.total, 2)
        assert.equal((await invoke('list', { updatedFrom: 4000 })).data.total, 0)
        const invalid = await invoke('list', { updatedFrom: 'abc' })
        assert.equal(invalid.code, 400)
    })
    await test('关键字 + 状态 + 时间范围 + 分页组合总数准确', async () => {
        seedOrders([
            { orderNo: '563001', batchNo: 'APDD26X3001', orderStatus: 'draft', updatedAt: 1000 },
            { orderNo: '563002', batchNo: 'APDD26X3002', orderStatus: 'draft', updatedAt: 2000 },
            { orderNo: '563003', batchNo: 'APDD26X3003', orderStatus: 'confirmed', updatedAt: 3000 },
            { orderNo: '563004', batchNo: 'APDD26X3004', orderStatus: 'draft', updatedAt: 4000 }
        ])
        const query = { keyword: '56300', orderStatus: 'draft', updatedFrom: 500, updatedTo: 3500, pageSize: 1 }
        const first = await invoke('list', query)
        assert.equal(first.code, 0)
        assert.equal(first.data.total, 2)
        assert.equal(first.data.list.length, 1)
        const second = await invoke('list', { ...query, page: 2 })
        assert.equal(second.data.total, 2)
        assert.equal(second.data.list.length, 1)
        assert.notEqual(first.data.list[0].orderNo, second.data.list[0].orderNo)
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
