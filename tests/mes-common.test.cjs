// 公共模块单元测试（node 运行：node tests/mes-common.test.cjs）
const assert = require('node:assert')
const crypto = require('crypto')
const common = require('../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')

// mock uniCloud（checkAuth 查用户表用）
const users = {
    uid1: { _id: 'uid1', status: 1 },
    uid2: { _id: 'uid2', status: 0 }
}
global.uniCloud = {
    database() {
        return {
            collection() {
                return {
                    doc(id) {
                        return {
                            get: async () => ({ data: users[id] ? [users[id]] : [] })
                        }
                    }
                }
            }
        }
    }
}

process.env.MES_TOKEN_SECRET = 'test-secret-1234567890abcdef'

let passed = 0
let failed = 0
function test(name, fn) {
    return Promise.resolve().then(fn).then(() => {
        passed++
        console.log('  ✓ ' + name)
    }).catch(e => {
        failed++
        console.error('  ✗ ' + name)
        console.error('    ' + (e.message || e))
    })
}

const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

;(async () => {
    await test('createToken/checkToken 往返', () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1', role: ['admin'] }, secret)
        const p = common.checkToken(t.token, secret)
        assert.strictEqual(p.uid, 'uid1')
        assert.deepStrictEqual(p.role, ['admin'])
    })

    await test('checkToken 拒绝篡改签名', () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1' }, secret)
        const tampered = t.token.slice(0, -1) + (t.token.endsWith('A') ? 'B' : 'A')
        const p = common.checkToken(tampered, secret)
        assert.ok(p.errCode)
    })

    await test('checkToken 拒绝过期 token', () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1' }, secret)
        const [payloadStr] = t.token.split('.')
        const payload = JSON.parse(Buffer.from(payloadStr.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
        payload.exp = Date.now() - 1000
        const newPayloadStr = b64(Buffer.from(JSON.stringify(payload)))
        const sig = b64(crypto.createHmac('sha256', secret).update(newPayloadStr).digest())
        const p = common.checkToken(newPayloadStr + '.' + sig, secret)
        assert.strictEqual(p.errCode, 'TOKEN_EXPIRED')
    })

    await test('checkAuth 放行有效账号', async () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1', role: [] }, secret)
        const a = await common.checkAuth(global.uniCloud.database(), t.token)
        assert.strictEqual(a.errCode, 0)
        assert.strictEqual(a.uid, 'uid1')
    })

    await test('checkAuth 拒绝禁用账号', async () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid2', role: [] }, secret)
        const a = await common.checkAuth(global.uniCloud.database(), t.token)
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAuth 未配置密钥时返回 500', async () => {
        const old = process.env.MES_TOKEN_SECRET
        delete process.env.MES_TOKEN_SECRET
        const a = await common.checkAuth(global.uniCloud.database(), 'whatever')
        process.env.MES_TOKEN_SECRET = old
        assert.strictEqual(a.errCode, 500)
    })

    await test('ok/fail 响应封装', () => {
        assert.deepStrictEqual(common.ok({ a: 1 }), { code: 0, message: 'ok', data: { a: 1 } })
        assert.deepStrictEqual(common.fail(400, 'x'), { code: 400, message: 'x' })
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
