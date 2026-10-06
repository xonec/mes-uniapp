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
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('photo-one').toString('base64')
const PHOTO2 = 'data:image/jpeg;base64,' + Buffer.from('photo-two').toString('base64')
let calls = []
global.uniCloud = {
    database: () => db,
    httpclient: { async request(url, options) {
        calls.push({ url, ...options })
        return { statusCode: 200, data: { choices: [{ message: { content: JSON.stringify({
            productCode: '1306008056', productName: '蛋白粉', packSpec: '1.8kg/瓶*4瓶/箱',
            materials: [{ materialCode: '1314001002-1', materialName: '混合粉料', unit: '千克' }],
            orderNo: '559290', batchNo: 'APDD26X1006', plannedQty: 250, uncertain: []
        }) } }] } }
    } }
}
let fn
function reset(config = {}) {
    db.store.clear(); calls = []
    db.ensure('uni-id-users').set('u1', { _id: 'u1', role: [] })
    db.ensure('uni-id-users').set('admin', { _id: 'admin', role: ['admin'] })
    db.ensure('config').set('ocr', { apiKey: 'secret-test-key', apiUrl: 'https://example.com/chat/completions', model: 'vision-test', textModel: 'text-test', dailyLimit: 10, userDailyLimit: 10, dedupMinutes: 0, timeout: 5000, maxAttempts: 1, ...config })
    delete require.cache[require.resolve(path.join(root, 'doc-ocr/index.js'))]
    fn = require(path.join(root, 'doc-ocr/index.js'))
}
const invoke = (action, data = {}, uid = 'u1') => fn.main({ action, uniIdToken: 'tok-' + uid, ...(action === 'recognize' ? { useModel: true } : {}), ...data })
let failed = 0, passed = 0
async function test(name, f) {
    reset()
    try { await f(); passed++; console.log('✓ ' + name) }
    catch (error) { failed++; console.error('✗ ' + name + '\n' + error.stack) }
}
;(async () => {
    await test('BOM 多页照片识别只返回档案字段，保留物料编号后缀', async () => {
        const r = await invoke('recognize', { images: [PHOTO, PHOTO2], purpose: 'bom' })
        assert.equal(r.code, 0)
        assert.equal(r.data.orderNo, undefined)
        assert.equal(r.data.materials[0].materialCode, '1314001002-1')
        assert.equal(calls[0].data.messages[1].content.filter(p => p.type === 'image_url').length, 2)
    })
    await test('缓存区分 BOM 和订单识别用途', async () => {
        reset({ dedupMinutes: 10 })
        assert.equal((await invoke('recognize', { imageBase64: PHOTO, purpose: 'bom' })).code, 0)
        assert.equal((await invoke('recognize', { imageBase64: PHOTO, purpose: 'bom' })).code, 0)
        const order = await invoke('recognize', { imageBase64: PHOTO, purpose: 'order' })
        assert.equal(order.data.orderNo, '559290')
        assert.equal(calls.length, 2)
    })
    await test('并发识别只能原子消费一次个人额度', async () => {
        reset({ userDailyLimit: 1 })
        const results = await Promise.all([PHOTO, PHOTO2].map(imageBase64 => invoke('recognize', { imageBase64, purpose: 'bom' })))
        assert.deepEqual(results.map(r => r.code).sort(), [0, 429])
        assert.equal(calls.length, 1)
    })
    await test('只有管理员可以读写配置，返回值不包含明文 Key', async () => {
        assert.equal((await invoke('getConfig')).code, 403)
        const result = await invoke('getConfig', {}, 'admin')
        assert.equal(result.code, 0)
        assert.ok(!JSON.stringify(result.data).includes('secret-test-key'))
        assert.equal((await invoke('setConfig', { config: { model: 'other-model' } }, 'admin')).code, 0)
        assert.equal(db.ensure('config').get('ocr').apiKey, 'secret-test-key')
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
