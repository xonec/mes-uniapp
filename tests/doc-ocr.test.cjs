const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
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
const PHOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('photo-one')]).toString('base64')
const PHOTO2 = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('photo-two')]).toString('base64')
let calls = []
const files = new Map()
global.uniCloud = {
    database: () => db,
    async downloadFile({ fileID }) { return { fileContent: files.get(fileID) } },
    async uploadFile({ cloudPath, fileContent }) { const fileID = 'cloud://test/' + cloudPath; files.set(fileID, fileContent); return { fileID } },
    async deleteFile({ fileList }) { fileList.forEach(id => files.delete(id)); return {} },
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
    db.store.clear(); calls = []; files.clear()
    db.ensure('uni-id-users').set('u1', { _id: 'u1', role: [] })
    db.ensure('uni-id-users').set('admin', { _id: 'admin', role: ['admin'] })
    db.ensure('config').set('ocr', { _id: 'ocr', updatedAt: 1, apiKey: 'secret-test-key', apiUrl: 'https://example.com/chat/completions', model: 'vision-test', textModel: 'text-test', dailyLimit: 10, userDailyLimit: 10, dedupMinutes: 0, timeout: 5000, maxAttempts: 1, ...config })
    delete require.cache[require.resolve(path.join(root, 'doc-ocr/index.js'))]
    fn = require(path.join(root, 'doc-ocr/index.js'))
}
const invoke = (action, data = {}, uid = 'u1') => fn.main({ action, uniIdToken: 'tok-' + uid, ...(action === 'recognize' ? { useModel: true } : {}), ...data })
/** 按真实客户端协议先查哈希，再按需上传原图；所有存储与模型请求均为测试桩。 */
async function recognize(images, purpose = 'bom', mutateFile) {
    const bytes = images.map(image => Buffer.from(image.split(',')[1], 'base64'))
    const originalHashes = bytes.map(value => createHash('sha256').update(value).digest('hex'))
    const processedHashes = bytes.map(value => createHash('sha256').update(Buffer.concat([value, Buffer.from('compressed')])).digest('hex'))
    const payload = { originalHashes, processedHashes, purpose, useModel: true }
    const checked = await invoke('checkRecognition', payload)
    if (checked.code !== 0 || !checked.data.needsOriginalImages) return checked
    const info = checked.data
    const originalFileIds = bytes.map((value, index) => {
        const id = 'cloud://test/' + info.originalUploadPrefix + index + '.image'
        files.set(id, mutateFile ? mutateFile(value) : value)
        return id
    })
    return invoke('recognize', { ...payload, originalFileIds, uploadKey: info.uploadKey, uploadOwner: info.uploadOwner })
}
let failed = 0, passed = 0
async function test(name, f) {
    reset()
    try { await f(); passed++; console.log('✓ ' + name) }
    catch (error) { failed++; console.error('✗ ' + name + '\n' + error.stack) }
}
;(async () => {
    await test('BOM 多页照片识别只返回档案字段，保留物料编号后缀', async () => {
        const r = await recognize([PHOTO, PHOTO2])
        assert.equal(r.code, 0)
        assert.equal(r.data.orderNo, undefined)
        assert.equal(r.data.materials[0].materialCode, '1314001002-1')
        assert.equal(calls[0].data.messages[1].content.filter(p => p.type === 'image_url').length, 2)
        assert.deepEqual(calls[0].data.messages[1].content.filter(p => p.type === 'image_url').map(p => p.image_url.url), [PHOTO, PHOTO2])
        assert.ok(r.data.sourceDocumentId)
        assert.ok(r.data.recognitionRunId)
    })
    await test('缓存区分 BOM 和订单识别用途', async () => {
        reset({ dedupMinutes: 10 })
        assert.equal((await recognize([PHOTO])).code, 0)
        assert.equal((await recognize([PHOTO])).code, 0)
        const order = await recognize([PHOTO], 'order')
        assert.equal(order.data.orderNo, '559290')
        assert.equal(calls.length, 2)
    })
    await test('并发识别只能原子消费一次个人额度', async () => {
        reset({ userDailyLimit: 1 })
        const results = await Promise.all([PHOTO, PHOTO2].map(image => recognize([image])))
        assert.deepEqual(results.map(r => r.code).sort(), [0, 429])
        assert.equal(calls.length, 1)
    })
    await test('只有管理员可以读写配置，返回值不包含明文 Key', async () => {
        assert.equal((await invoke('getConfig')).code, 403)
        const result = await invoke('getConfig', {}, 'admin')
        assert.equal(result.code, 0)
        assert.ok(!JSON.stringify(result.data).includes('secret-test-key'))
        assert.equal((await invoke('setConfig', { config: { model: 'other-model' }, expectedUpdatedAt: 1 }, 'admin')).code, 0)
        assert.equal(db.ensure('config').get('ocr').apiKey, 'secret-test-key')
    })
    await test('相同原图命中缓存，不再次调用模型或重新上传归档', async () => {
        const first = await recognize([PHOTO])
        assert.equal(first.code, 0)
        const stored = db.ensure('source_image_assets').size
        const second = await recognize([PHOTO])
        assert.equal(second.code, 0)
        assert.equal(second.data.modelUsed, false)
        assert.equal(calls.length, 1)
        assert.equal(db.ensure('source_image_assets').size, stored)
        assert.equal(second.data.sourceDocumentId, first.data.sourceDocumentId)
    })
    await test('原图字节与哈希不符时停止模型调用', async () => {
        const result = await recognize([PHOTO], 'bom', value => Buffer.concat([value, Buffer.from('tampered')]))
        assert.equal(result.code, 400)
        assert.equal(calls.length, 0)
    })
    await test('同一组选图重复哈希时不上传或调用模型', async () => {
        assert.equal((await recognize([PHOTO, PHOTO])).code, 400)
        assert.equal(files.size, 0)
        assert.equal(calls.length, 0)
    })
    await test('旧版直接传照片不能绕过上传前校验', async () => {
        assert.equal((await invoke('recognize', { images: [PHOTO], purpose: 'bom' })).code, 400)
        assert.equal(calls.length, 0)
    })
    await test('初筛失败时给出引擎原因，而不是静默当作未找到编码', async () => {
        reset()
        const bytes = Buffer.from(PHOTO.split(',')[1], 'base64')
        const hash = createHash('sha256').update(bytes).digest('hex')
        const checked = await fn.main({ action: 'checkRecognition', uniIdToken: 'tok-u1', originalHashes: [hash], processedHashes: [hash], purpose: 'order' })
        assert.equal(checked.code, 0)
        assert.equal(checked.data.needsProcessedImages, true)
        const result = await fn.main({ action: 'recognize', uniIdToken: 'tok-u1', images: [PHOTO], originalHashes: [hash], processedHashes: [hash], purpose: 'order', useModel: false, uploadKey: checked.data.uploadKey, uploadOwner: checked.data.uploadOwner })
        assert.equal(result.code, 0)
        assert.match(result.data.message, /初筛未能确认/)
        assert.match(result.data.message, /免费初筛失败/)
        assert.match(result.data.message, /引擎2/)
        assert.equal(Array.isArray(result.data.screenErrors), true)
        assert.match(result.data.screenErrors[0].message, /未配置 Key/)
    })
    await test('初筛超时立即返回可读提示，不干等也不调用大模型', async () => {
        reset({ ocrSpaceApiKey: 'ocr-space-test-key' })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async () => { const error = new Error('ResponseTimeoutError'); error.code = 'ResponseTimeoutError'; throw error }
        try {
            const bytes = Buffer.from(PHOTO.split(',')[1], 'base64')
            const hash = createHash('sha256').update(bytes).digest('hex')
            const checked = await fn.main({ action: 'checkRecognition', uniIdToken: 'tok-u1', originalHashes: [hash], processedHashes: [hash], purpose: 'order' })
            assert.equal(checked.code, 0)
            const startedAt = Date.now()
            const result = await fn.main({ action: 'recognize', uniIdToken: 'tok-u1', images: [PHOTO], originalHashes: [hash], processedHashes: [hash], purpose: 'order', useModel: false, uploadKey: checked.data.uploadKey, uploadOwner: checked.data.uploadOwner })
            assert.equal(result.code, 0)
            assert.match(result.data.message, /免费初筛超时/)
            assert.match(result.data.message, /引擎2/)
            assert.match(result.data.message, /已跳过/)
            assert.equal(Array.isArray(result.data.screenErrors), true)
            assert.equal(result.data.screenErrors[0].code, 503)
            assert.ok(Date.now() - startedAt < 15000, '初筛超时应快速返回')
            assert.equal(calls.length, 0, '初筛未确认编码时不得调用大模型')
        } finally { global.uniCloud.httpclient.request = original }
    })
    await test('配置过期版本拒绝覆盖现有 Key', async () => {
        const result = await invoke('setConfig', { config: { apiKey: 'replacement-test-key' }, expectedUpdatedAt: 0 }, 'admin')
        assert.equal(result.code, 409)
        assert.equal(db.ensure('config').get('ocr').apiKey, 'secret-test-key')
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
