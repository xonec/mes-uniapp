// 人员档案绑定登录账号（node 运行：node tests/bind-personnel-accounts.test.cjs）
// 覆盖：唯一姓名（去空白）绑定 + 归档/审计、同名多义跳过、已绑不同 uid 跳过、
//       dryRun 不写库、找不到跳过、幂等（二次 bound=0）、非管理员拒绝。

const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const TARGET = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-operations/bind-personnel.js')
const ClientError = class ClientError extends Error {
    constructor(message, status) { super(message); this.code = status; this.status = status }
}

function createDb(tables = {}) {
    const store = {}
    for (const [name, rows] of Object.entries(tables)) store[name] = rows.map(row => ({ ...row }))
    const ensure = name => { if (!store[name]) store[name] = []; return store[name] }
    const matches = (row, condition) => {
        if (!condition || !Object.keys(condition).length) return true
        return Object.keys(condition).every(key => {
            const node = condition[key]
            if (node && typeof node === 'object' && '$exists' in node) return node.$exists ? row[key] !== undefined : row[key] === undefined
            return row[key] === node
        })
    }
    const collection = name => {
        const query = condition => {
            const state = { condition, limit: 1000 }
            const api = {
                where(next) { state.condition = next; return api },
                limit(value) { state.limit = value; return api },
                async get() { return { data: ensure(name).filter(row => matches(row, state.condition)).map(row => ({ ...row })).slice(0, state.limit) } },
                async update(patch) {
                    const rows = ensure(name).filter(row => matches(row, state.condition))
                    for (const row of rows) Object.assign(row, patch)
                    return { updated: rows.length }
                }
            }
            return api
        }
        const base = query(null)
        base.doc = id => ({
            async set(payload) {
                const rows = ensure(name)
                const index = rows.findIndex(row => row._id === id)
                const next = { _id: id, ...payload }
                if (index >= 0) rows[index] = next
                else rows.push(next)
                return { updated: 1 }
            }
        })
        return base
    }
    const db = { collection, command: { exists: value => ({ $exists: value }) } }
    return { db, store, ensure }
}

function load(tables) {
    const fake = createDb(tables)
    const original = Module._load
    Module._load = function (request) {
        if (request === 'mes-common') return { ClientError }
        if (request === 'mes-document-store') return { updatedCount: result => Number((result && (result.updated ?? result.affectedDocs)) || 0) }
        if (request === './shared') {
            return {
                collection: type => 'mes_ops_' + type,
                all: async (db, name, where = {}, maximum = 5000) => {
                    const result = await db.collection(name).where(where).limit(maximum).get()
                    return result.data || []
                }
            }
        }
        return original.apply(this, arguments)
    }
    delete require.cache[TARGET]
    const module = require(TARGET)
    Module._load = original
    return { module, db: fake.db, store: fake.store, ensure: fake.ensure, admin: { isAdmin: true, uid: 'admin', name: '管理员', personId: '' }, guest: { isAdmin: false, uid: 'u1', name: '张三', personId: 'p1' } }
}

const employee = (name, uid, id = 'emp:' + (uid || name)) => ({ _id: id, name, uid, state: 'ready' })
const person = (name, uid, id = 'ops:personnel:' + name) => ({ _id: id, name, uid, version: 1, enabled: true, updatedAt: 1, updatedBy: 'creator' })

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name); console.error('    ' + (error && error.message || error)) }
}

;(async () => {
    console.log('\n人员档案绑定登录账号')

    await test('唯一姓名（去空白精确匹配）绑定，写版本/审计/归档，二次执行幂等', async () => {
        const loaded = load({
            mes_employee_accounts: [employee('于 家园', 'u-emp'), employee('无账号人员', '')],
            mes_ops_personnel: [person('于家园', '', 'ops:personnel:YG-1')]
        })
        const first = await loaded.module.bindPersonnelAccounts(loaded.db, loaded.admin, {})
        assert.equal(first.totalEmployee, 1, '只统计 state=ready 且有 uid 的员工')
        assert.equal(first.totalPersonnel, 1)
        assert.equal(first.bound, 1)
        assert.equal(first.ambiguous.length, 0)
        const bound = loaded.ensure('mes_ops_personnel')[0]
        assert.equal(bound.uid, 'u-emp')
        assert.equal(bound.version, 2)
        assert.equal(bound.audit.reason, '按员工档案绑定登录账号')
        assert.deepEqual(bound.audit.changedFields, ['uid'])
        assert.equal(bound.updatedBy, 'admin')
        const archived = loaded.ensure('mes_ops_versions').find(row => row._id === 'ver:ops:personnel:YG-1:1')
        assert.ok(archived, '应归档旧快照')
        assert.equal(archived.snapshot.uid, '')
        const second = await loaded.module.bindPersonnelAccounts(loaded.db, loaded.admin, {})
        assert.equal(second.bound, 0, '二次执行不应重复绑定')
        assert.ok(second.skipped.some(item => /已绑定相同账号/.test(item.reason)))
        assert.equal(loaded.ensure('mes_ops_personnel')[0].version, 2)
    })

    await test('同名多义跳过：员工侧或人员侧有多条同名都不猜', async () => {
        const byEmployee = load({
            mes_employee_accounts: [employee('李四', 'u-a'), employee('李四', 'u-b')],
            mes_ops_personnel: [person('李四', '')]
        })
        const r1 = await byEmployee.module.bindPersonnelAccounts(byEmployee.db, byEmployee.admin, {})
        assert.equal(r1.bound, 0)
        assert.deepEqual(r1.ambiguous, ['李四'])
        assert.match(r1.skipped[0].reason, /多位同名人员/)
        assert.equal(byEmployee.ensure('mes_ops_personnel')[0].uid, '')

        const byPersonnel = load({
            mes_employee_accounts: [employee('王五', 'u-c')],
            mes_ops_personnel: [person('王五', '', 'ops:personnel:A'), person('王五', '', 'ops:personnel:B')]
        })
        const r2 = await byPersonnel.module.bindPersonnelAccounts(byPersonnel.db, byPersonnel.admin, {})
        assert.equal(r2.bound, 0)
        assert.deepEqual(r2.ambiguous, ['王五'])
        assert.equal(byPersonnel.ensure('mes_ops_personnel').filter(row => row.uid).length, 0)
    })

    await test('人员档案已绑定不同账号时跳过，不覆盖', async () => {
        const loaded = load({
            mes_employee_accounts: [employee('赵六', 'u-emp')],
            mes_ops_personnel: [person('赵六', 'u-old', 'ops:personnel:Z')]
        })
        const result = await loaded.module.bindPersonnelAccounts(loaded.db, loaded.admin, {})
        assert.equal(result.bound, 0)
        assert.match(result.skipped[0].reason, /已绑定其他账号/)
        assert.equal(loaded.ensure('mes_ops_personnel')[0].uid, 'u-old')
    })

    await test('dryRun 只出计划，不写主档也不写归档', async () => {
        const loaded = load({
            mes_employee_accounts: [employee('孙七', 'u-emp')],
            mes_ops_personnel: [person('孙七', '')]
        })
        const result = await loaded.module.bindPersonnelAccounts(loaded.db, loaded.admin, { dryRun: true })
        assert.equal(result.dryRun, true)
        assert.equal(result.bound, 1, 'dryRun 的 bound 表示计划绑定数')
        assert.ok(result.skipped.some(item => item.reason.startsWith('dryRun')))
        assert.equal(loaded.ensure('mes_ops_personnel')[0].uid, '')
        assert.equal(loaded.ensure('mes_ops_versions').length, 0)
    })

    await test('找不到同名账号的人员进 skipped，不影响其他人', async () => {
        const loaded = load({
            mes_employee_accounts: [employee('周八', 'u-a'), employee('吴九', 'u-b')],
            mes_ops_personnel: [person('周八', ''), person('郑十', '')]
        })
        const result = await loaded.module.bindPersonnelAccounts(loaded.db, loaded.admin, {})
        assert.equal(result.bound, 1)
        assert.ok(result.skipped.some(item => item.name === '郑十' && /找不到同名账号/.test(item.reason)))
    })

    await test('非管理员拒绝执行', async () => {
        const loaded = load({ mes_employee_accounts: [], mes_ops_personnel: [] })
        try {
            await loaded.module.bindPersonnelAccounts(loaded.db, loaded.guest, {})
        } catch (error) {
            assert.equal(error.code, 403)
            assert.match(error.message, /仅管理员/)
            return
        }
        assert.fail('非管理员应当被拒绝')
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
