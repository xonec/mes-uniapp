// 公共模块单元测试（node 运行：node tests/mes-common.test.cjs）
const assert = require('node:assert')
const crypto = require('crypto')
const common = require('../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')

// mock uniCloud（checkAuth / checkAdmin 查用户表用）
const users = {
    uid1: { _id: 'uid1', status: 1 },
    uid2: { _id: 'uid2', status: 0 },
    uid3: { _id: 'uid3', status: 1, role: ['admin'] },
    uid4: { _id: 'uid4', status: 1, role: [] }
}
// 模拟数据库故障：'none' 正常；'always' 每次 get 都抛；'once' 首次抛、重试成功
let dbFailMode = 'none'
let dbFailCount = 0
global.uniCloud = {
    database() {
        return {
            collection() {
                return {
                    doc(id) {
                        return {
                            get: async () => {
                                if (dbFailMode === 'always') throw new Error('db down')
                                if (dbFailMode === 'once' && dbFailCount++ === 0) throw new Error('db blip')
                                return { data: users[id] ? [users[id]] : [] }
                            }
                        }
                    }
                }
            }
        }
    }
}
function setDbFailMode(m) { dbFailMode = m; dbFailCount = 0 }

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

    await test('checkAuth 查库失败 → 拒绝（fail-closed，503）', async () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1', role: [] }, secret)
        setDbFailMode('always')
        const a = await common.checkAuth(global.uniCloud.database(), t.token)
        setDbFailMode('none')
        assert.strictEqual(a.errCode, 503, '不应放行被禁用/改密风险未知的 token')
        assert.ok(!a.uid)
    })

    await test('checkAuth 查库瞬时失败但重试成功 → 放行', async () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid1', role: [] }, secret)
        setDbFailMode('once')
        const a = await common.checkAuth(global.uniCloud.database(), t.token)
        setDbFailMode('none')
        assert.strictEqual(a.errCode, 0)
        assert.strictEqual(a.uid, 'uid1')
    })

    await test('checkAuth 拒绝改密后的旧 token（pwdVersion 不匹配）', async () => {
        const secret = common.getTokenSecret()
        const old = users.uid1.pwdVersion
        users.uid1.pwdVersion = 2
        const t = common.createToken({ uid: 'uid1', role: [], pv: 1 }, secret)
        const a = await common.checkAuth(global.uniCloud.database(), t.token)
        users.uid1.pwdVersion = old
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAdmin 放行管理员 / 拒绝普通用户', async () => {
        const secret = common.getTokenSecret()
        const adminToken = common.createToken({ uid: 'uid3', role: ['admin'] }, secret).token
        const userToken = common.createToken({ uid: 'uid4', role: [] }, secret).token
        const a1 = await common.checkAdmin(global.uniCloud.database(), adminToken)
        assert.strictEqual(a1.errCode, 0)
        const a2 = await common.checkAdmin(global.uniCloud.database(), userToken)
        assert.strictEqual(a2.errCode, 403)
    })

    await test('checkAdmin 查库失败 → 拒绝（fail-closed，503）', async () => {
        const secret = common.getTokenSecret()
        const t = common.createToken({ uid: 'uid3', role: ['admin'] }, secret)
        setDbFailMode('always')
        const a = await common.checkAdmin(global.uniCloud.database(), t.token)
        setDbFailMode('none')
        assert.strictEqual(a.errCode, 503)
    })

    await test('ok/fail 响应封装', () => {
        assert.deepStrictEqual(common.ok({ a: 1 }), { code: 0, message: 'ok', data: { a: 1 } })
        assert.deepStrictEqual(common.fail(400, 'x'), { code: 400, message: 'x' })
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
