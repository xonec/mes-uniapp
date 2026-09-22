// production-records 云函数单元测试（node 运行：node tests/production-records.test.cjs）
// 覆盖：首次保存 / 内容去重 / 版本归档 / 乐观锁重试 / 更新计数形状兼容 /
//       批号校验 / 鉴权 / 草稿按 uid 隔离 / 回滚 / 游标分页
//
// 做法：用一个「内存版 uniCloud.database()」替身 + 把裸模块名 mes-common 指到真实公共模块。

const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---- 把云函数里的 require('mes-common') / require('uni-id-common') 指到真实模块 / 测试桩 ----
const MES_COMMON = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')
const UNIID_STUB = path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'mes-common') return MES_COMMON
    if (request === 'uni-id-common') return UNIID_STUB
    return origResolve.call(this, request, ...args)
}

process.env.MES_TOKEN_SECRET = 'test-secret'

const common = require(MES_COMMON)

// ================= 内存版 uniCloud 数据库替身 =================
const store = {}                       // { collName: Map<_id, doc> }
let UPDATE_RESULT_MODE = 'affectedDocsTop'  // 'affectedDocsTop' | 'updated' | 'none'
let noopUpdatesRemaining = 0           // >0 时，where().update() 不生效（模拟乐观锁冲突）

function updateResult(n) {
    if (UPDATE_RESULT_MODE === 'none') return {}                 // 形状无法识别 → 走回读复核
    if (UPDATE_RESULT_MODE === 'updated') return { updated: n }
    return { affectedDocs: n }
}
function clone(v) { return JSON.parse(JSON.stringify(v)) }
function matchCond(doc, cond) {
    if (!cond) return true
    return Object.keys(cond).every(k => {
        const c = cond[k]
        if (c && typeof c === 'object' && '$lt' in c) return doc[k] < c.$lt
        return doc[k] === c
    })
}
function ensure(name) { if (!store[name]) store[name] = new Map(); return store[name] }

function makeQuery(name, cond) {
    const q = {
        orderBy(f, d) { q._order = f; q._dir = d || 'asc'; return q },
        skip(n) { q._skip = n; return q },
        limit(n) { q._limit = n; return q },
        field(f) { q._field = f; return q },
        async get() {
            let rows = [...ensure(name).values()].map(clone).filter(r => matchCond(r, cond))
            if (q._order) {
                rows.sort((a, b) => {
                    const x = a[q._order], y = b[q._order]
                    return q._dir === 'desc' ? (y > x ? 1 : y < x ? -1 : 0) : (x > y ? 1 : x < y ? -1 : 0)
                })
            }
            if (q._skip) rows = rows.slice(q._skip)
            if (q._limit) rows = rows.slice(0, q._limit)
            if (q._field) rows = rows.map(r => {
                const o = {}
                Object.keys(q._field).forEach(k => { if (q._field[k]) o[k] = r[k] })
                return o
            })
            return { data: rows }
        },
        async update(data) {
            if (noopUpdatesRemaining > 0) { noopUpdatesRemaining--; return updateResult(0) }
            let n = 0
            for (const [id, d] of ensure(name)) {
                if (matchCond(d, cond)) { ensure(name).set(id, Object.assign({}, d, data)); n++ }
            }
            return updateResult(n)
        }
    }
    return q
}

function makeCollection(name) {
    const base = makeQuery(name, null)
    base.doc = (id) => ({
        async get() { const d = ensure(name).get(id); return { data: d ? [clone(d)] : [] } },
        async set(data) { ensure(name).set(id, Object.assign({}, data, { _id: id })); return { updated: 1 } },
        async update(data) {
            if (!ensure(name).has(id)) return updateResult(0)
            ensure(name).set(id, Object.assign({}, ensure(name).get(id), data))
            return updateResult(1)
        },
        async remove() { return updateResult(ensure(name).delete(id) ? 1 : 0) }
    })
    base.where = (cond) => makeQuery(name, cond)
    base.add = async (doc) => {
        const id = doc._id || ('auto_' + Math.random().toString(36).slice(2))
        if (ensure(name).has(id)) { const e = new Error('duplicate key error'); throw e }
        ensure(name).set(id, Object.assign({}, doc, { _id: id }))
        return { id }
    }
    base.count = async () => ({ total: ensure(name).size })
    return base
}

global.uniCloud = {
    database: () => ({ collection: (name) => makeCollection(name), command: { lt: (v) => ({ $lt: v }) } })
}

const fn = require('../uniCloud-alipay/cloudfunctions/production-records/index.js')

// ================= 测试小框架 =================
let passed = 0, failed = 0
async function test(name, f) {
    try { await f(); passed++; console.log('  ✓ ' + name) }
    catch (e) { failed++; console.error('  ✗ ' + name); console.error('    ' + (e && e.message || e)) }
}
function reset() {
    Object.keys(store).forEach(k => delete store[k])
    UPDATE_RESULT_MODE = 'affectedDocsTop'
    noopUpdatesRemaining = 0
    // 预置正常用户（checkAuth 回查用户表 status / role；uni-id 语义 status 0=正常）
    ensure('uni-id-users').set('u1', { _id: 'u1', status: 0, role: ['user'] })
    ensure('uni-id-users').set('u2', { _id: 'u2', status: 0, role: ['user'] })
}
const tokenFor = (uid) => 'tok-' + uid
const BATCH = 'OPDG26X1001'
const rec = (over = {}) => Object.assign({
    batchNo: BATCH, productCode: '1306005930', batchStatus: 'incomplete',
    bottlePerCase: 6, casePerPallet: 49, materialInputs: {},
    caseCount: 10, bucketCount: 2, materials: { 标签: 10 }, savedAt: '2026-01-01T00:00:00.000Z'
}, over)
const save = (record, uid = 'u1') => fn.main({ action: 'upsert', uniIdToken: tokenFor(uid), record })

;(async () => {
    console.log('\nproduction-records 云函数测试')

    await test('首次保存 → version 1，无历史版本', async () => {
        reset()
        const r = await save(rec())
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.version, 1)
        assert.strictEqual(r.data.unchanged, false)
        assert.strictEqual(ensure('production_record_versions').size, 0)
    })

    await test('内容未变再次保存 → unchanged=true，不升版本、不归档', async () => {
        reset()
        await save(rec())
        const r = await save(rec({ savedAt: '2026-01-02T00:00:00.000Z' })) // 仅时间戳不同
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.unchanged, true)
        assert.strictEqual(r.data.version, 1)
        assert.strictEqual(ensure('production_record_versions').size, 0)
    })

    await test('内容有变 → version 2，且 v1 已归档', async () => {
        reset()
        await save(rec())
        const r = await save(rec({ caseCount: 20 }))
        assert.strictEqual(r.data.version, 2)
        assert.strictEqual(r.data.unchanged, false)
        const vers = ensure('production_record_versions')
        assert.strictEqual(vers.size, 1)
        assert.strictEqual(vers.get('ver:' + BATCH + ':1').snapshot.caseCount, 10)
        assert.strictEqual(ensure('production_records').get('rec:' + BATCH).caseCount, 20)
    })

    await test('update 返回形状无法识别（{}）→ 回读复核，不误报并发冲突', async () => {
        reset()
        await save(rec())
        UPDATE_RESULT_MODE = 'none'   // 复现 A-1：计数识别不出来
        const r = await save(rec({ caseCount: 33 }))
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.version, 2)
        assert.strictEqual(ensure('production_records').get('rec:' + BATCH).caseCount, 33)
    })

    await test('乐观锁冲突（条件更新未生效）→ 自动重试成功', async () => {
        reset()
        await save(rec())
        noopUpdatesRemaining = 1       // 第一次条件更新「不生效」，模拟被并发抢先
        const r = await save(rec({ caseCount: 44 }))
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.version, 2)
        assert.strictEqual(ensure('production_records').get('rec:' + BATCH).caseCount, 44)
    })

    await test('批号非法 → 500 且错误信息可读', async () => {
        reset()
        const r = await save(rec({ batchNo: 'abc' }))
        assert.strictEqual(r.code, 500)
        assert.ok(/批号非法/.test(r.message), r.message)
    })

    await test('未带 token → 401', async () => {
        reset()
        const r = await fn.main({ action: 'upsert', record: rec() })
        assert.strictEqual(r.code, 401)
    })

    await test('草稿按 uid 隔离：同 deviceId 不同用户互不可见', async () => {
        reset()
        const s = await fn.main({ action: 'saveDraft', uniIdToken: tokenFor('u1'), deviceId: 'dev-x', record: rec() })
        assert.strictEqual(s.code, 0)
        const mine = await fn.main({ action: 'getDraft', uniIdToken: tokenFor('u1'), deviceId: 'dev-x', batchNo: BATCH })
        assert.ok(mine.data && mine.data.record, '本人应能读到自己的草稿')
        const other = await fn.main({ action: 'getDraft', uniIdToken: tokenFor('u2'), deviceId: 'dev-x', batchNo: BATCH })
        assert.strictEqual(other.data, null, '他人不应读到该草稿')
        // 主键里必须含 uid
        assert.ok(ensure('production_drafts').has('draft:u1:dev-x:' + BATCH))
    })

    await test('设备ID非法 → 500', async () => {
        reset()
        const r = await fn.main({ action: 'getDraft', uniIdToken: tokenFor('u1'), deviceId: '!!!', batchNo: BATCH })
        assert.strictEqual(r.code, 500)
    })

    await test('回滚到 v1 → 生成 v3 且内容等于 v1', async () => {
        reset()
        await save(rec())                     // v1: caseCount 10
        await save(rec({ caseCount: 20 }))    // v2
        const r = await fn.main({ action: 'rollback', uniIdToken: tokenFor('u1'), batchNo: BATCH, version: 1 })
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.version, 3)
        const cur = ensure('production_records').get('rec:' + BATCH)
        assert.strictEqual(cur.version, 3)
        assert.strictEqual(cur.caseCount, 10)
    })

    await test('回滚不存在的版本 → 404', async () => {
        reset()
        await save(rec())
        const r = await fn.main({ action: 'rollback', uniIdToken: tokenFor('u1'), batchNo: BATCH, version: 99 })
        assert.strictEqual(r.code, 404)
    })

    await test('list / listVersions / get 基本可用', async () => {
        reset()
        await save(rec())
        await save(rec({ caseCount: 20 }))
        const list = await fn.main({ action: 'list', uniIdToken: tokenFor('u1'), limit: 10 })
        assert.strictEqual(list.code, 0)
        assert.strictEqual(list.data.list.length, 1)
        assert.strictEqual(list.data.list[0].batchNo, BATCH)
        assert.strictEqual(list.data.hasMore, false)
        const vers = await fn.main({ action: 'listVersions', uniIdToken: tokenFor('u1'), batchNo: BATCH })
        assert.strictEqual(vers.code, 0)
        assert.strictEqual(vers.data.length, 1)
        assert.strictEqual(vers.data[0].version, 1)
        const got = await fn.main({ action: 'get', uniIdToken: tokenFor('u1'), batchNo: BATCH })
        assert.strictEqual(got.data.version, 2)
    })

    await test('list 游标分页：before 过滤 + hasMore/nextBefore', async () => {
        reset()
        await save(rec())                                   // 记录 1
        ensure('production_records').get('rec:' + BATCH).updatedAt = 1000
        await save(rec({ batchNo: 'OPDG26X1002', caseCount: 5 })) // 记录 2
        ensure('production_records').get('rec:OPDG26X1002').updatedAt = 2000
        const p1 = await fn.main({ action: 'list', uniIdToken: tokenFor('u1'), limit: 1 })
        assert.strictEqual(p1.data.list.length, 1)
        assert.strictEqual(p1.data.list[0].batchNo, 'OPDG26X1002')
        assert.strictEqual(p1.data.hasMore, true)
        assert.strictEqual(p1.data.nextBefore, 2000)
        const p2 = await fn.main({ action: 'list', uniIdToken: tokenFor('u1'), limit: 1, before: p1.data.nextBefore })
        assert.strictEqual(p2.data.list[0].batchNo, BATCH)
        assert.strictEqual(p2.data.hasMore, false)
    })

    await test('封禁用户（status=1）→ 401', async () => {
        reset()
        ensure('uni-id-users').get('u1').status = 1 // uni-id 语义：封禁
        const r = await fn.main({ action: 'get', uniIdToken: tokenFor('u1'), batchNo: BATCH })
        assert.strictEqual(r.code, 401)
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
