// 排班导入的人员处理（node 运行：node tests/personnel-import.test.cjs）
// 覆盖本次确认的规则 A：排班导入**只建待建号的人员档案，不建登录账号**，
// 并把本次新建的人员清单返回给后台，由管理员到「人员与账号」统一建号。
//
// 做法：拦截 personnel-import.js 的三个依赖，用替身驱动纯业务分支，不连数据库。

const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const TARGET = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-operations/personnel-import.js')

/** 每个场景重建一次模块，避免替身状态串场。 */
function load(scenario) {
  const saved = []
  const ClientError = class ClientError extends Error { constructor(message, status) { super(message); this.status = status } }
  const original = Module._load
  Module._load = function (request) {
    if (request === 'mes-common') return { ClientError }
    if (request === './scope') {
      return {
        admin(profile) { if (!profile.isAdmin) throw new ClientError('仅管理员可维护基础资料', 403) },
        active: async (db, type, id) => ({ _id: id, name: '一车间' })
      }
    }
    if (request === './catalogs') {
      return {
        async saveCatalog(db, profile, payload) {
          saved.push(payload.record)
          return { _id: 'ops:personnel:' + payload.record.code, version: 1, ...payload.record }
        }
      }
    }
    if (request === './shared') {
      return {
        all: (...args) => args,
        and: (...args) => args,
        collection: type => 'mes_ops_' + type,
        identifier: value => String(value),
        text: value => String(value == null ? '' : value),
        digest: () => 'ABCD1234EFGH5678',
        date: value => String(value),
        get: async (db, type, id) => (scenario.existingPerson && type === 'personnel' ? scenario.existingPerson : null),
        expectedVersion() {},
        requestId() {},
        withScheduleLock: async (db, id, fn) => fn()
      }
    }
    return original.apply(this, arguments)
  }
  delete require.cache[TARGET]
  const loaded = require(TARGET)
  Module._load = original
  return { loaded, saved }
}

/** 只实现 personnel-import 用到的那几层链式方法。 */
function fakeDb(personnelMatches) {
  return {
    command: { or: (...args) => args },
    collection(name) {
      return {
        where() { return this },
        limit() { return this },
        async get() { return { data: name === 'mes_ops_personnel' ? personnelMatches : [] } }
      }
    }
  }
}

const PROFILE = { uid: 'admin', isAdmin: true }
const INPUT = { workshopId: 'w1', importRuleVersion: 3, replaceDay: false, rows: [{ personName: '张三', date: '2026-10-16', kind: 'work' }] }

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name) }

;(async () => {
  await test('未知姓名：只建人员档案（uid 为空），不建登录账号', async () => {
    const { loaded, saved } = load({})
    const result = await loaded.prepareScheduleImport(fakeDb([]), PROFILE, INPUT)
    assert.equal(result.created, 1)
    assert.equal(result.createdPeople.length, 1)
    assert.equal(result.createdPeople[0].name, '张三')
    assert.match(result.createdPeople[0].code, /^YG-/)
    assert.equal(saved.length, 1)
    assert.equal(saved[0].uid, '', '排班导入不得建账号：人员档案的 uid 必须为空')
    assert.equal(saved[0].autoCreated, true)
    assert.equal(result.rows[0].personId, 'ops:personnel:' + result.createdPeople[0].code)
  })

  await test('已存在人员：不重复建档、清单为空', async () => {
    const existingPerson = { _id: 'ops:personnel:EXIST', code: 'EXIST', name: '张三', workshopId: 'w1', enabled: true, uid: '' }
    const { loaded, saved } = load({ existingPerson })
    const result = await loaded.prepareScheduleImport(fakeDb([existingPerson]), PROFILE, INPUT)
    assert.equal(result.created, 0)
    assert.deepEqual(result.createdPeople, [])
    assert.equal(saved.length, 0)
    assert.equal(result.rows[0].personId, existingPerson._id)
  })

  await test('同名多人：拒绝猜测', async () => {
    const { loaded } = load({})
    const rows = [{ _id: 'a', code: 'A', name: '张三', workshopId: 'w1', enabled: true }, { _id: 'b', code: 'B', name: '张三', workshopId: 'w1', enabled: true }]
    await assert.rejects(() => loaded.prepareScheduleImport(fakeDb(rows), PROFILE, INPUT), /同名人员/)
  })

  await test('旧规则版本：拒绝旧客户端', async () => {
    const { loaded } = load({})
    await assert.rejects(() => loaded.prepareScheduleImport(fakeDb([]), PROFILE, { ...INPUT, importRuleVersion: 2 }), /排班导入规则已更新/)
  })

  await test('非管理员被拒绝', async () => {
    const { loaded } = load({})
    await assert.rejects(() => loaded.prepareScheduleImport(fakeDb([]), { uid: 'u', isAdmin: false }, INPUT), /仅管理员可维护基础资料/)
  })

  console.log('')
  console.log('排班导入人员处理：' + passed + ' passed, 0 failed')
})().catch(error => { console.error('FAILED ' + (error && error.stack || error)); process.exit(1) })
