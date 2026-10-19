// utils/cloud-call.js 错误归一回归：系统级失败（云函数超时/断网）必须变成可读文案。
import assert from 'node:assert/strict'

let scripted = null
const calls = []
globalThis.uni = {
    getStorageSync: () => 'test-token',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reLaunch: () => {}
}
globalThis.uniCloud = {
    callFunction: async options => {
        calls.push(options)
        if (scripted) return scripted(options)
        return { result: { code: 0, data: {} } }
    }
}
const { callCloud } = await import('../utils/cloud-call.js')

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name + '\n    ' + error.message) }
}

console.log('cloud-call:')

await test('系统级 request:fail 归一成可读文案并保留 requestId', async () => {
    scripted = async () => {
        const error = new Error('request:fail')
        error.errMsg = 'request:fail'
        error.code = 'SYSTEM_ERROR'
        error.requestId = 'rid-123'
        throw error
    }
    const error = await callCloud('doc-ocr', 'recognize', {}).then(() => null, value => value)
    assert.ok(error, '应当抛错')
    assert.match(error.message, /云端识别中断/)
    assert.match(error.message, /已等待约 \d+ 秒/)
    assert.match(error.message, /重试或手动录入/)
    assert.equal(error.kind, 'timeout')
    assert.equal(error.code, 'SYSTEM_ERROR')
    assert.equal(error.requestId, 'rid-123')
    assert.equal(error.cause, 'request:fail')
})

await test('超时文案同样归一且保留原始 errMsg', async () => {
    scripted = async () => { const error = new Error('request:fail timeout'); error.errMsg = 'request:fail timeout'; throw error }
    const error = await callCloud('doc-ocr', 'recognize', {}).then(() => null, value => value)
    assert.match(error.message, /云端识别中断/)
    assert.equal(error.cause, 'request:fail timeout')
})

await test('doc-ocr recognize 用 100s，原图归档长调用 210s，普通调用 60s', async () => {
    scripted = null
    await callCloud('doc-ocr', 'recognize', {})
    await callCloud('production-orders', 'commitSourceImages', {})
    await callCloud('user-admin', 'profile', {})
    assert.equal(calls[calls.length - 3].timeout, 100000)
    assert.equal(calls[calls.length - 2].timeout, 210000)
    assert.equal(calls[calls.length - 1].timeout, 60000)
})

await test('业务错误保持原样（code/message 不被改写）', async () => {
    scripted = async () => ({ result: { code: 503, message: '请先上传新版 doc-ocr' } })
    const error = await callCloud('doc-ocr', 'recognize', {}).then(() => null, value => value)
    assert.equal(error.message, '请先上传新版 doc-ocr')
    assert.equal(error.code, 503)
})

await test('成功时返回 data 并自动附带 token', async () => {
    scripted = async () => ({ result: { code: 0, data: { ok: 1 } } })
    const data = await callCloud('doc-ocr', 'getCapabilities', {})
    assert.deepEqual(data, { ok: 1 })
    assert.equal(calls[calls.length - 1].data.uniIdToken, 'test-token')
})

await test('只读请求首次超时后自动重试一次并成功', async () => {
    let count = 0
    scripted = async () => {
        count++
        if (count === 1) { const error = new Error('request:fail timeout'); error.errMsg = 'request:fail timeout'; throw error }
        return { result: { code: 0, data: { ok: 1, attempt: count } } }
    }
    const data = await callCloud('production-operations', 'bootstrap', {}, { retry: true })
    assert.deepEqual(data, { ok: 1, attempt: 2 })
    assert.equal(count, 2)
})

await test('写请求（未开 retry）超时只调用一次、不重试', async () => {
    let count = 0
    scripted = async () => { count++; const error = new Error('request:fail timeout'); error.errMsg = 'request:fail timeout'; throw error }
    const error = await callCloud('production-operations', 'saveAttendance', {}, { retry: false }).then(() => null, value => value)
    assert.ok(error, '应当抛错')
    assert.equal(count, 1, '写请求不能自动重试')
})

await test('业务错误不重试（code 非 0 直接抛）', async () => {
    let count = 0
    scripted = async () => { count++; return { result: { code: 503, message: '函数请求已收到但未执行' } } }
    const error = await callCloud('production-operations', 'dashboard', {}, { retry: true }).then(() => null, value => value)
    assert.equal(error.message, '函数请求已收到但未执行')
    assert.equal(count, 1, '业务错误不属于冷启动重试范围')
})

console.log('')
if (failed) { console.error('cloud-call: ' + failed + ' failed'); process.exitCode = 1 }
else console.log('cloud-call: ' + passed + ' passed, 0 failed')
