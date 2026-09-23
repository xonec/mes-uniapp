// 公共模块单元测试（node 运行：node tests/mes-common.test.cjs）
// 鉴权已切换为 uni-id：token 校验委托 uni-id-common（此处用测试桩），
// 本文件重点测 checkAuth / checkAdmin 的 fail-closed 语义与角色/封禁判断。
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---- require('uni-id-common') 指到测试桩 ----
const UNIID_STUB = path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'uni-id-common') return UNIID_STUB
    return origResolve.call(this, request, ...args)
}

const common = require('../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')

// mock uniCloud（checkAuth / checkAdmin 查用户表用）
// uni-id status 语义：0/未设置=正常；1=封禁；2=审核中；3=审核失败；4=已注销
const users = {
    uid1: { _id: 'uid1', status: 0 },
    uid2: { _id: 'uid2', status: 1 },
    uid3: { _id: 'uid3', status: 0, role: ['admin'] },
    uid4: { _id: 'uid4', status: 0, role: [] }
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

const tokenFor = (uid) => 'tok-' + uid
const db = () => global.uniCloud.database()

;(async () => {
    await test('checkAuth 放行有效账号', async () => {
        const a = await common.checkAuth(db(), tokenFor('uid1'))
        assert.strictEqual(a.errCode, 0)
        assert.strictEqual(a.uid, 'uid1')
    })

    await test('checkAuth 拒绝封禁账号（status=1）', async () => {
        const a = await common.checkAuth(db(), tokenFor('uid2'))
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAuth 未带 token → 401', async () => {
        const a = await common.checkAuth(db(), '')
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAuth 坏 token → 401', async () => {
        const a = await common.checkAuth(db(), 'garbage-token')
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAuth 账号不存在 → 401', async () => {
        const a = await common.checkAuth(db(), tokenFor('ghost'))
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAuth 查库失败 → 拒绝（fail-closed，503）', async () => {
        setDbFailMode('always')
        const a = await common.checkAuth(db(), tokenFor('uid1'))
        setDbFailMode('none')
        assert.strictEqual(a.errCode, 503)
        assert.ok(!a.uid)
    })

    await test('checkAuth 查库瞬时失败但重试成功 → 放行', async () => {
        setDbFailMode('once')
        const a = await common.checkAuth(db(), tokenFor('uid1'))
        setDbFailMode('none')
        assert.strictEqual(a.errCode, 0)
        assert.strictEqual(a.uid, 'uid1')
    })

    await test('checkAuth 拒绝改密后的旧 token（valid_token_date 晚于签发）', async () => {
        const old = users.uid1.valid_token_date
        users.uid1.valid_token_date = Date.now() // 刚改密
        const a = await common.checkAuth(db(), tokenFor('uid1'))
        users.uid1.valid_token_date = old
        assert.strictEqual(a.errCode, 401)
    })

    await test('checkAdmin 放行管理员 / 拒绝普通用户', async () => {
        const a1 = await common.checkAdmin(db(), tokenFor('uid3'))
        assert.strictEqual(a1.errCode, 0)
        const a2 = await common.checkAdmin(db(), tokenFor('uid4'))
        assert.strictEqual(a2.errCode, 403)
    })

    await test('checkAdmin 查库失败 → 拒绝（fail-closed，503）', async () => {
        setDbFailMode('always')
        const a = await common.checkAdmin(db(), tokenFor('uid3'))
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
