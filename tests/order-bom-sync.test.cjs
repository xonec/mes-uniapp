// 订单保存后自动同步 BOM（有变化才升版本、旧版归档、保留计算参数、失败不阻塞）。
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
const { syncOrderBom } = require(path.join(root, 'common/mes-document-store/bom-store.js'))
const invoke = (action, data = {}, uid = 'u1') => orders.main({ action, uniIdToken: 'tok-' + uid, ...data })
const baseOrder = (orderNo, extra = {}) => ({
    orderNo, productCode: '1306008056', productName: '乳清蛋白粉', packSpec: '1.8kg/瓶*4瓶/箱',
    batchNo: 'APDD26X1006', plannedQty: 250, sampleCount: '7',
    materials: [
        { seq: 1, materialCode: '1314001002-1', materialName: '混合粉料', spec: 'APDD', materialVersion: 'N/A', unit: '千克' },
        { seq: 2, materialCode: '3100003463', materialName: '标签', spec: 'APDD-200g', materialVersion: '02', unit: '只' }
    ],
    ...extra
})
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
const bomOf = () => db.ensure('product_bom').get('bom:1306008056')
;(async () => {
    await test('新建订单自动建 BOM v1，新行给安全默认并列出 needsConfig', async () => {
        const result = await invoke('save', { record: baseOrder('571001'), expectedVersion: 0 })
        assert.equal(result.code, 0)
        assert.deepEqual(result.data.bom, { action: 'created', version: 1, needsConfig: ['1314001002-1', '3100003463'] })
        const bom = bomOf()
        assert.equal(bom.bomVersion, 1)
        assert.equal(bom.source, 'order')
        assert.equal(bom.sourceOrderNo, '571001')
        assert.equal(bom.enabled, true)
        assert.equal(bom.materials.length, 2)
        for (const row of bom.materials) {
            assert.equal(row.basis, 'manual')
            assert.equal(row.qtyPerBasis, 1)
            assert.equal(row.wasteRate, 0)
            assert.equal(row.roundMode, 'ceil')
        }
    })
    await test('订单内容未变时 BOM 幂等，不写库不升版本', async () => {
        await invoke('save', { record: baseOrder('571002'), expectedVersion: 0 })
        const result = await invoke('upsert', { record: baseOrder('571002', { plannedQty: 300, changeReason: '改产量' }), expectedVersion: 1 }, 'admin')
        assert.equal(result.code, 0)
        assert.deepEqual(result.data.bom, { action: 'unchanged' })
        assert.equal(bomOf().bomVersion, 1)
        assert.equal(db.ensure('product_bom_versions').size, 0)
    })
    await test('物料描述变化时升版本、旧版归档，且保留同编码行的计算参数', async () => {
        await invoke('save', { record: baseOrder('571003'), expectedVersion: 0 })
        // 人工补齐第一行计算参数
        const before = bomOf()
        before.materials[0].basis = 'inner'
        before.materials[0].qtyPerBasis = 0.2
        before.materials[0].wasteRate = 0.02
        before.materials[0].roundMode = 'none'
        db.ensure('product_bom').set('bom:1306008056', before)
        const changed = baseOrder('571003')
        changed.materials[0].materialName = '混合粉料-新版'
        const result = await invoke('upsert', { record: { ...changed, changeReason: '更新物料名称' }, expectedVersion: 1 }, 'admin')
        assert.equal(result.code, 0, result.message)
        assert.equal(result.data.bom.action, 'updated')
        assert.equal(result.data.bom.version, 2)
        assert.deepEqual(result.data.bom.needsConfig, [])
        const bom = bomOf()
        assert.equal(bom.bomVersion, 2)
        assert.equal(bom.materials[0].materialName, '混合粉料-新版')
        assert.equal(bom.materials[0].basis, 'inner')
        assert.equal(bom.materials[0].qtyPerBasis, 0.2)
        assert.equal(bom.materials[0].wasteRate, 0.02)
        assert.equal(bom.materials[0].roundMode, 'none')
        const archive = db.ensure('product_bom_versions').get('ver:1306008056:1')
        assert.ok(archive, '应归档旧版本')
        assert.equal(archive.bomVersion, 1)
        assert.equal(archive.sourceOrderNo, '571003')
        assert.equal(archive.materials[0].materialName, '混合粉料')
    })
    await test('订单新增物料行时 needsConfig 只列新增物料，已有行参数不动', async () => {
        await invoke('save', { record: baseOrder('571004'), expectedVersion: 0 })
        const bomBefore = bomOf()
        bomBefore.materials[1].basis = 'case'; bomBefore.materials[1].qtyPerBasis = 0.052
        db.ensure('product_bom').set('bom:1306008056', bomBefore)
        const changed = baseOrder('571004')
        changed.materials.push({ seq: 3, materialCode: '3100009999', materialName: '新纸箱', spec: 'X', materialVersion: 'N/A', unit: '只' })
        const result = await invoke('upsert', { record: { ...changed, changeReason: '新增物料' }, expectedVersion: 1 }, 'admin')
        assert.equal(result.code, 0, result.message)
        assert.deepEqual(result.data.bom.needsConfig, ['3100009999'])
        const bom = bomOf()
        assert.equal(bom.materials.length, 3)
        assert.equal(bom.materials[1].basis, 'case')
        assert.equal(bom.materials[1].qtyPerBasis, 0.052)
        assert.equal(bom.materials[2].basis, 'manual')
    })
    await test('BOM 写入异常不阻塞订单保存，返回 failed 原因', async () => {
        db.failWrite = 'product_bom'
        const result = await invoke('save', { record: baseOrder('571005'), expectedVersion: 0 })
        assert.equal(result.code, 0)
        assert.equal(result.data.bom.action, 'failed')
        assert.ok(String(result.data.bom.error || '').length > 0)
        assert.ok(db.ensure('production_orders').get('order:571005'), '订单仍应保存成功')
    })
    await test('无物料清单时跳过 BOM 同步', async () => {
        const result = await invoke('save', { record: baseOrder('571006', { materials: [] }), expectedVersion: 0 })
        assert.equal(result.code, 0)
        assert.deepEqual(result.data.bom, { action: 'skipped' })
        assert.equal(db.ensure('product_bom').size, 0)
    })
    await test('无产品编码时跳过 BOM 同步', async () => {
        const result = await syncOrderBom(db, { orderNo: '571007', productCode: '', materials: baseOrder('571007').materials }, 'u1')
        assert.deepEqual(result, { action: 'skipped' })
        assert.equal(db.ensure('product_bom').size, 0)
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
