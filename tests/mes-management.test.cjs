const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createMemoryDb } = require('./helpers/memory-db.cjs')
const root = path.join(__dirname, '../uniCloud-alipay/cloudfunctions')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'uni-id-common') return path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
    if (['mes-common', 'mes-document-store', 'order-parser', 'ocr-config'].includes(request)) return path.join(root, 'common', request, 'index.js')
    return resolve.call(this, request, ...args)
}
const db = createMemoryDb()
global.uniCloud = { database: () => db }
const products = require(path.join(root, 'product-materials/index.js'))
const record = name => ({ productCode: '1306008056', productName: name || '乳清蛋白粉', packSpec: '1.8kg/瓶*4瓶/箱', materials: [
    { seq: 1, materialCode: '1314001002-1', materialName: '混合粉料', spec: 'APDD', materialVersion: 'N/A', unit: '千克' }
] })
const invoke = (fn, action, data = {}, uid = 'u1') => fn.main({ action, uniIdToken: 'tok-' + uid, ...data })
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
;(async () => {
    await test('同一产品重复导入保持唯一主键和实际版本号', async () => {
        const first = await invoke(products, 'upsert', { record: record(), expectedVersion: 0 })
        assert.equal(first.code, 0)
        const same = await invoke(products, 'upsert', { record: record(), expectedVersion: 1 })
        assert.equal(same.data.version, 1)
        assert.equal(db.ensure('product_materials').size, 1)
        assert.equal(db.ensure('product_materials').get('mat:1306008056').materials[0].materialCode, '1314001002-1')
    })
    await test('已有产品必须匹配确认时的版本，两个并发修改只有一个成功', async () => {
        await invoke(products, 'upsert', { record: record() })
        const results = await Promise.all(['甲', '乙'].map(name => invoke(products, 'upsert', { record: record(name), expectedVersion: 1 })))
        assert.deepEqual(results.map(result => result.code).sort(), [0, 409])
        const history = db.ensure('product_materials_versions').get('ver:1306008056:1')
        assert.equal(history.snapshot.productName, '乳清蛋白粉')
        assert.equal(db.ensure('product_materials').get('mat:1306008056').version, 2)
    })
    await test('历史保存失败时不得覆盖当前产品', async () => {
        await invoke(products, 'upsert', { record: record() })
        db.failWrite = 'product_materials_versions'
        const result = await invoke(products, 'upsert', { record: record('修改') })
        assert.notEqual(result.code, 0)
        assert.equal(db.ensure('product_materials').get('mat:1306008056').productName, '乳清蛋白粉')
    })
    await test('后台列表需要管理员，支持分页和字面量搜索', async () => {
        await invoke(products, 'upsert', { record: record('产品[甲]') })
        assert.equal((await invoke(products, 'adminList')).code, 403)
        const result = await invoke(products, 'adminList', { keyword: '[甲]', page: 1, pageSize: 10 }, 'admin')
        assert.equal(result.code, 0)
        assert.equal(result.data.total, 1)
        assert.equal(result.data.list[0].materialCount, 1)
    })
    await test('后台停用产品必须管理员并保护版本', async () => {
        await invoke(products, 'upsert', { record: record() })
        assert.equal((await invoke(products, 'setEnabled', { productCode: record().productCode, enabled: false, expectedVersion: 1 })).code, 403)
        assert.equal((await invoke(products, 'setEnabled', { productCode: record().productCode, enabled: false, expectedVersion: 1 }, 'admin')).code, 0)
        assert.equal(db.ensure('product_materials').get('mat:1306008056').enabled, false)
        assert.equal((await invoke(products, 'list')).data.length, 0)
    })
    await test('普通录入接口不能绕过后台权限停用或重新启用产品', async () => {
        assert.equal((await invoke(products, 'upsert', { record: { ...record(), enabled: false } })).code, 403)
        await invoke(products, 'upsert', { record: { ...record(), enabled: false } }, 'admin')
        assert.equal((await invoke(products, 'upsert', { record: record(), expectedVersion: 1 })).code, 403)
        assert.equal(db.ensure('product_materials').get('mat:1306008056').enabled, false)
    })
    await test('订单录入与后台管理使用同一订单集合，陈旧修改被拒绝', async () => {
        const orders = require(path.join(root, 'production-orders/index.js'))
        const order = { ...record(), orderNo: '559290', batchNo: 'APDD26X1006', plannedQty: 250, sampleCount: '7' }
        assert.equal((await invoke(orders, 'save', { record: order, expectedVersion: 0 })).code, 0)
        assert.equal((await invoke(orders, 'list')).code, 403)
        const list = await invoke(orders, 'list', { keyword: '559290' }, 'admin')
        assert.equal(list.data.total, 1)
        assert.equal((await invoke(orders, 'upsert', { record: { ...order, plannedQty: 300 }, expectedVersion: 1 }, 'admin')).data.version, 2)
        assert.equal((await invoke(orders, 'upsert', { record: order, expectedVersion: 1 }, 'admin')).code, 409)
        assert.equal((await invoke(orders, 'setEnabled', { orderNo: '559290', enabled: false, expectedVersion: 2 }, 'admin')).code, 0)
        assert.equal((await invoke(orders, 'list', {}, 'admin')).data.total, 0)
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
