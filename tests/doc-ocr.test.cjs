const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { createMemoryDb } = require('./helpers/memory-db.cjs')
const OCR_SPACE_FIXTURE = require('./fixtures/ocr-space-zld1.json')
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
    db.ensure('config').set('ocr', { _id: 'ocr', updatedAt: 1, apiKey: 'secret-test-key', apiUrl: 'https://example.com/chat/completions', model: 'vision-test', textModel: 'text-test', dailyLimit: 10, userDailyLimit: 10, dedupMinutes: 0, timeout: 5000, maxAttempts: 1, flowMode: 'model-first', ...config })
    delete require.cache[require.resolve(path.join(root, 'doc-ocr/index.js'))]
    fn = require(path.join(root, 'doc-ocr/index.js'))
}
const invoke = (action, data = {}, uid = 'u1') => fn.main({ action, uniIdToken: 'tok-' + uid, ...(action === 'recognize' ? { useModel: true } : {}), ...data })
/** 按真实客户端协议先查哈希，再按需上传原图；所有存储与模型请求均为测试桩。 */
async function recognize(images, purpose = 'bom', mutateFile, options = {}) {
    const bytes = images.map(image => Buffer.from(image.split(',')[1], 'base64'))
    const originalHashes = bytes.map(value => createHash('sha256').update(value).digest('hex'))
    const processedHashes = bytes.map(value => createHash('sha256').update(options.processedAsSubmitted ? value : Buffer.concat([value, Buffer.from('compressed')])).digest('hex'))
    const payload = { originalHashes, processedHashes, purpose, useModel: true }
    const checked = await invoke('checkRecognition', payload)
    if (checked.code !== 0 || !checked.data.needsOriginalImages) return checked
    const info = checked.data
    const originalFileIds = bytes.map((value, index) => {
        const id = 'cloud://test/' + info.originalUploadPrefix + index + '.image'
        files.set(id, mutateFile ? mutateFile(value) : value)
        return id
    })
    return invoke('recognize', { ...payload, originalFileIds, uploadKey: info.uploadKey, uploadOwner: info.uploadOwner, ...(options.fallbackImages ? { fallbackImages: options.fallbackImages } : {}) })
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
    await test('并发识别只原子消费一次个人额度（额度不足转免费 OCR 兜底）', async () => {
        reset({ userDailyLimit: 1 })
        const results = await Promise.all([PHOTO, PHOTO2].map(image => recognize([image])))
        assert.deepEqual(results.map(r => r.code), [0, 0])
        assert.equal(calls.length, 1, '只允许一个请求真正调用模型')
        const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
        const counter = db.ensure('ocr_quota').get('u:' + date + ':u1')
        assert.equal(Number(counter && counter.calls) || 0, 1)
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
    await test('免费识别失败时给出引擎原因，而不是静默当作未找到编码', async () => {
        reset({ flowMode: 'screen-first' })
        const bytes = Buffer.from(PHOTO.split(',')[1], 'base64')
        const hash = createHash('sha256').update(bytes).digest('hex')
        const checked = await fn.main({ action: 'checkRecognition', uniIdToken: 'tok-u1', originalHashes: [hash], processedHashes: [hash], purpose: 'order' })
        assert.equal(checked.code, 0)
        assert.equal(checked.data.needsProcessedImages, true)
        const result = await fn.main({ action: 'recognize', uniIdToken: 'tok-u1', images: [PHOTO], originalHashes: [hash], processedHashes: [hash], purpose: 'order', useModel: false, uploadKey: checked.data.uploadKey, uploadOwner: checked.data.uploadOwner })
        assert.equal(result.code, 0)
        assert.match(result.data.message, /未能确认 10 位产品编码/)
        assert.match(result.data.message, /免费识别失败/)
        assert.match(result.data.message, /引擎2/)
        assert.equal(Array.isArray(result.data.screenErrors), true)
        assert.match(result.data.screenErrors[0].message, /未配置 Key/)
    })
    await test('免费识别超时立即返回可读提示，不干等也不调用大模型', async () => {
        reset({ ocrSpaceApiKey: 'ocr-space-test-key', flowMode: 'screen-first' })
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
            assert.match(result.data.message, /免费识别超时/)
            assert.match(result.data.message, /引擎2/)
            assert.match(result.data.message, /已跳过/)
            assert.equal(Array.isArray(result.data.screenErrors), true)
            assert.equal(result.data.screenErrors[0].code, 503)
            assert.ok(Date.now() - startedAt < 15000, '免费识别超时应快速返回')
            assert.equal(calls.length, 0, '免费识别未确认编码时不得调用大模型')
        } finally { global.uniCloud.httpclient.request = original }
    })
    const BUDGET_ENV = ['OCR_RECOGNITION_DEADLINE_MS', 'OCR_MODEL_TOTAL_BUDGET_MS']
    function clearBudgetEnv() { BUDGET_ENV.forEach(key => delete process.env[key]) }
    await test('整次识别预算可由环境变量收缩：deadline 过小时不发起模型请求', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '300'
        reset({ timeout: 5000, maxAttempts: 2 })
        try {
            const result = await recognize([PHOTO])
            assert.equal(result.code, 0)
            assert.equal(calls.length, 0, 'deadline 不足时不得发起模型请求')
            assert.ok(result.data.modelFailure, '应返回模型失败摘要')
            assert.match(result.data.message, /大模型未成功/)
        } finally { clearBudgetEnv() }
    })
    await test('默认预算为 180s 窗口档 165/155/15/10，并打印到日志', async () => {
        clearBudgetEnv()
        reset({ timeout: 60000, maxAttempts: 2 })
        const logs = []
        const originalLog = console.log
        console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args) }
        try {
            const result = await recognize([PHOTO])
            assert.equal(result.code, 0)
        } finally { console.log = originalLog }
        const budgetLine = logs.find(line => line.includes('预算 deadline='))
        assert.ok(budgetLine, '应打印当前生效预算')
        assert.match(budgetLine, /deadline=165000/)
        assert.match(budgetLine, /model=155000/)
        assert.match(budgetLine, /screen=15000/)
        assert.match(budgetLine, /page=10000/)
    })
    await test('模型阶段预算可由环境变量控制，单次 timeout 按剩余尝试次数均分', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '15000'
        reset({ timeout: 60000, maxAttempts: 2 })
        try {
            const result = await recognize([PHOTO])
            assert.equal(result.code, 0)
            assert.equal(calls.length, 1)
            assert.ok(calls[0].timeout >= 5000 && calls[0].timeout <= 5600, '15s 预算/2 次应收缩到约 5.5s，实际 ' + calls[0].timeout)
        } finally { clearBudgetEnv() }
        reset({ timeout: 60000, maxAttempts: 2 })
        const normal = await recognize([PHOTO])
        assert.equal(normal.code, 0)
        assert.equal(calls[0].timeout, 60000, '默认 155s 预算下不应把 60s 单次超时缩小')
    })
    await test('模型超时返回业务错误，而不是被系统掐断', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '15000'
        reset({
            timeout: 60000, maxAttempts: 2, maxModelCalls: 6,
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ]
        })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            const error = new Error('RequestTimeoutError')
            error.code = 'RequestTimeoutError'
            throw error
        }
        try {
            const startedAt = Date.now()
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            const elapsed = Date.now() - startedAt
            assert.equal(result.code, 0, '模型失败应转免费 OCR 兜底而不是直接抛错')
            assert.match(result.data.message, /大模型未成功/)
            assert.match(result.data.message, /免费 OCR 兜底也失败/)
            const modelCalls = calls.filter(call => String(call.url).includes('chat/completions'))
            const ocrCalls = calls.filter(call => String(call.url).includes('ocr.space'))
            assert.equal(modelCalls.length, 4, '两个通道各 2 次尝试都应发出')
            assert.equal(ocrCalls.length, 1, '模型失败后应调用一次免费 OCR 兜底')
            assert.equal(result.data.modelFailure.attempts.length, 2, '每个通道应有一条失败摘要')
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.provider), ['DeepSeek', '硅基流动'])
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.status), ['failed', 'failed'])
            assert.equal(result.data.fallback, undefined)
            assert.ok(result.data.modelFailure.summary, '应带每个通道的供应商摘要')
            assert.match(result.data.modelFailure.summary, /DeepSeek \/ deepseek-flash/)
            assert.match(result.data.modelFailure.summary, /硅基流动 \/ deepseek-ai\/DeepSeek-V4.1-Flash/)
            assert.match(result.data.modelFailure.summary, /RequestTimeoutError/)
            assert.match(result.data.message, /通道明细/)
            assert.ok(elapsed < 15000, '超时路径应远早于平台窗口返回，实际 ' + elapsed + 'ms')
        } finally {
            global.uniCloud.httpclient.request = original
            clearBudgetEnv()
        }
    })
    await test('模型请求预算耗尽时，message 带每个通道的供应商/模型/错误摘要', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '25000'
        reset({ timeout: 60000, maxAttempts: 2, maxModelCalls: 2, ocrSpaceApiKey: 'key-ocr',
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ]
        })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            if (String(url).includes('ocr.space')) return { status: 200, data: OCR_SPACE_FIXTURE }
            const error = new Error('RequestTimeoutError')
            error.code = 'RequestTimeoutError'
            throw error
        }
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
            assert.equal(result.data.recognitionSource, 'ocrspace-fallback')
            assert.match(result.data.modelFailure.reason, /请求上限/)
            assert.ok(result.data.modelFailure.summary, '预算耗尽也要带通道摘要')
            assert.match(result.data.modelFailure.summary, /DeepSeek/)
            assert.match(result.data.modelFailure.summary, /未尝试（预算不足）/, '被跳过的通道要说明原因')
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.status), ['failed', 'skipped'])
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.provider), ['DeepSeek', '硅基流动'])
            assert.match(result.data.message, /通道明细/)
            assert.equal(calls.filter(call => String(call.url).includes('chat/completions')).length, 2, '预算 2 次：主通道 2 次尝试后即耗尽，不再请求备通道')
        } finally {
            global.uniCloud.httpclient.request = original
            clearBudgetEnv()
        }
    })
    await test('日志打印实际生效的单次 timeout 与配置上限', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '15000'
        reset({ timeout: 60000, maxAttempts: 2 })
        const logs = []
        const originalLog = console.log
        console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args) }
        const originalRequest = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            const error = new Error('RequestTimeoutError')
            error.code = 'RequestTimeoutError'
            throw error
        }
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
        } finally {
            console.log = originalLog
            global.uniCloud.httpclient.request = originalRequest
            clearBudgetEnv()
            reset({ timeout: 60000, maxAttempts: 2 })
        }
        const line = logs.find(item => item.includes('模型请求 model='))
        assert.ok(line, '应打印每次模型请求的生效 timeout')
        assert.match(line, /timeout=5500/)
        assert.match(line, /配置上限 60000/)
        assert.match(line, /budget=/)
    })
    await test('真实通道失败（无效 Key / HTTP 401）也会把供应商明细写进 message', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '25000'
        reset({ timeout: 60000, maxAttempts: 1, maxModelCalls: 6, ocrSpaceApiKey: 'key-ocr',
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'bad-key' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'bad-key' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ]
        })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            if (String(url).includes('ocr.space')) return { status: 200, data: OCR_SPACE_FIXTURE }
            return { status: 401, data: { error: { message: 'invalid api key' } } }
        }
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
            assert.equal(result.data.recognitionSource, 'ocrspace-fallback')
            assert.match(result.data.message, /通道明细/)
            assert.match(result.data.message, /DeepSeek/)
            assert.match(result.data.message, /硅基流动/)
            assert.match(result.data.modelFailure.summary, /HTTP 401/)
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.provider), ['DeepSeek', '硅基流动'])
        } finally {
            global.uniCloud.httpclient.request = original
            clearBudgetEnv()
            reset({ timeout: 60000, maxAttempts: 2 })
        }
    })
    await test('配置过期版本拒绝覆盖现有 Key', async () => {
        const result = await invoke('setConfig', { config: { apiKey: 'replacement-test-key' }, expectedUpdatedAt: 0 }, 'admin')
        assert.equal(result.code, 409)
        assert.equal(db.ensure('config').get('ocr').apiKey, 'secret-test-key')
    })
    await test('model-first：模型成功直接返回，不跑 OCR.space', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '25000'
        reset({ timeout: 60000, maxAttempts: 1, maxModelCalls: 2, ocrSpaceApiKey: 'key-ocr',
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ],
        })
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
            assert.equal(result.data.flowMode, 'model-first')
            assert.equal(result.data.modelUsed, true)
            assert.equal(result.data.recognitionSource, 'model')
            assert.equal(result.data.fallback, undefined)
            assert.equal(calls.filter(call => String(call.url).includes('ocr.space')).length, 0, '模型成功时不应调用 OCR.space')
        } finally { clearBudgetEnv() }
    })
    await test('model-first：模型失败后走 OCR.space 兜底并返回文本与可解析字段', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '25000'
        reset({ timeout: 60000, maxAttempts: 1, maxModelCalls: 2, ocrSpaceApiKey: 'key-ocr',
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ],
        })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            if (String(url).includes('ocr.space')) return { status: 200, data: OCR_SPACE_FIXTURE }
            const error = new Error('RequestTimeoutError')
            error.code = 'RequestTimeoutError'
            throw error
        }
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
            assert.equal(result.data.recognitionSource, 'ocrspace-fallback')
            assert.equal(result.data.needsManualEntry, true)
            assert.equal(result.data.fallback.engine, 2)
            assert.match(result.data.fallback.text, /1306007453/)
            assert.equal(result.data.fallback.parsed.productCode, '1306007453')
            assert.equal(result.data.fallback.parsed.batchNo, 'AP9Y26X1019')
            assert.ok(result.data.fallback.textLength > 100)
            assert.equal(result.data.modelFailure.attempts.length, 2)
            assert.deepEqual(result.data.modelFailure.attempts.map(item => item.provider), ['DeepSeek', '硅基流动'])
            assert.ok(result.data.modelFailure.attempts.every(item => typeof item.ms === 'number' && item.error))
            assert.match(result.data.message, /已用免费 OCR 提取文本，请核对或手动录入/)
            assert.match(result.data.message, /通道明细/)
            assert.match(result.data.modelFailure.summary, /DeepSeek/)
            assert.equal(result.data.productCode, '1306007453')
        } finally { global.uniCloud.httpclient.request = original; clearBudgetEnv() }
    })
    await test('model-first：每日额度不足时直接走 OCR.space 兜底，不消耗模型请求', async () => {
        process.env.OCR_RECOGNITION_DEADLINE_MS = '30000'
        process.env.OCR_MODEL_TOTAL_BUDGET_MS = '25000'
        reset({ timeout: 60000, maxAttempts: 1, maxModelCalls: 2, ocrSpaceApiKey: 'key-ocr', userDailyLimit: 1,
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ],
        })
        const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
        db.ensure('ocr_quota').set('u:' + date + ':u1', { _id: 'u:' + date + ':u1', calls: 1, date })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            if (String(url).includes('ocr.space')) return { status: 200, data: OCR_SPACE_FIXTURE }
            return { statusCode: 200, data: { choices: [{ message: { content: '{}' } }] } }
        }
        try {
            const result = await recognize([PHOTO], 'order', null, { fallbackImages: [PHOTO], processedAsSubmitted: true })
            assert.equal(result.code, 0)
            assert.equal(result.data.recognitionSource, 'ocrspace-fallback')
            assert.match(result.data.modelFailure.reason, /上限/)
            assert.match(result.data.message, /通道明细/, '额度不足也要说明哪个通道没尝试')
            assert.ok(result.data.modelFailure.attempts.some(item => item.status === 'skipped'), '额度不足时应有 skipped 通道')
            assert.equal(calls.filter(call => String(call.url).includes('chat/completions')).length, 0, '额度不足不得发起模型请求')
            assert.equal(calls.filter(call => String(call.url).includes('ocr.space')).length, 1)
        } finally { global.uniCloud.httpclient.request = original; clearBudgetEnv() }
    })
    await test('screen-first：仍走旧流程（先免费识别预处理图，再按需上传原图并调模型）', async () => {
        reset({ flowMode: 'screen-first', timeout: 60000, maxAttempts: 1, maxModelCalls: 2, ocrSpaceApiKey: 'key-ocr',
            providers: [
                { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'key-ds' },
                { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: 'key-sf' },
                { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'key-ocr' }
            ],
            modelChain: [
                { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true },
                { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true }
            ],
        })
        const original = global.uniCloud.httpclient.request
        global.uniCloud.httpclient.request = async (url, options) => {
            calls.push({ url, ...options })
            if (String(url).includes('ocr.space')) return { status: 200, data: OCR_SPACE_FIXTURE }
            return { statusCode: 200, data: { choices: [{ message: { content: JSON.stringify({ productCode: '1306007453', productName: '蛋白粉', packSpec: '400g/瓶*6瓶/箱', materials: [], orderNo: '565077', batchNo: 'AP9Y26X1019', plannedQty: 100, uncertain: [] }) } }] } }
        }
        try {
            const bytes = [Buffer.from(PHOTO.split(',')[1], 'base64')]
            const originalHashes = bytes.map(value => createHash('sha256').update(value).digest('hex'))
            const processedHashes = originalHashes.slice()
            const checked = await fn.main({ action: 'checkRecognition', uniIdToken: 'tok-u1', originalHashes, processedHashes, purpose: 'order' })
            assert.equal(checked.code, 0)
            assert.equal(checked.data.needsProcessedImages, true, 'screen-first 仍先要求预处理图')
            const second = await fn.main({ action: 'recognize', uniIdToken: 'tok-u1', originalHashes, processedHashes, purpose: 'order', images: [PHOTO], uploadKey: checked.data.uploadKey, uploadOwner: checked.data.uploadOwner })
            assert.equal(second.code, 0)
            assert.equal(second.data.needsOriginalImages, true, '免费识别确认编码后仍需按需上传原图')
            const info = second.data
            const originalFileIds = bytes.map((value, index) => { const id = 'cloud://test/' + info.originalUploadPrefix + index + '.image'; files.set(id, value); return id })
            const final = await fn.main({ action: 'recognize', uniIdToken: 'tok-u1', originalHashes, processedHashes, purpose: 'order', originalFileIds, uploadKey: info.uploadKey, uploadOwner: info.uploadOwner })
            assert.equal(final.code, 0)
            assert.equal(final.data.modelUsed, true)
            assert.equal(final.data.recognitionSource, 'model')
            assert.equal(calls.filter(call => String(call.url).includes('ocr.space')).length, 1, '旧流程应先跑一次 OCR.space 免费识别')
        } finally { global.uniCloud.httpclient.request = original }
    })
    await test('配置默认流程为 screen-first（客户端 model-first 就绪前保持旧流程）', () => {
        const ocrConfig = require('ocr-config')
        assert.equal(ocrConfig.DEFAULT_OCR_CONFIG.flowMode, 'screen-first')
        assert.equal(ocrConfig.effectiveConfig({}, {}).flowMode, 'screen-first')
        assert.equal(ocrConfig.effectiveConfig({ flowMode: 'model-first' }, {}).flowMode, 'model-first')
        assert.equal(ocrConfig.effectiveConfig({ flowMode: 'unknown' }, {}).flowMode, 'screen-first')
    })
    console.log(`${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
})()
