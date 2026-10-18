// 考勤冲突处理权限（node 运行：node tests/attendance-conflict.test.cjs）
// 覆盖：管理员可处理他人冲突、非管理员处理他人冲突仍 403、本人处理、冲突清空与 audit actor/reason 区分。

const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const TARGET = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-operations/attendance.js')
const ClientError = class ClientError extends Error {
    constructor(message, status) { super(message); this.code = status; this.status = status }
}

const conflictRecord = () => ({
    _id: 'attendance:a1', personId: 'p1', personName: '张三', date: '2026-06-30', version: 2,
    kind: 'work', workHours: 8, shiftId: 's1', shiftName: '早班', processIds: ['proc1'], processNames: ['称重'],
    startTime: '08:00', endTime: '16:00', startDayOffset: 0, endDayOffset: 0,
    conflict: {
        incoming: { kind: 'work', workHours: 8, shiftId: 's2', shiftName: '中班', processIds: ['proc1'], startTime: '20:00', endTime: '23:00', startDayOffset: 0, endDayOffset: 1 },
        retained: { kind: 'work', workHours: 6, shiftId: 's1', shiftName: '早班', processIds: ['proc1'], startTime: '08:00', endTime: '14:00', startDayOffset: 0, endDayOffset: 0 }
    }
})

function load(record) {
    const captured = []
    const db = { command: { gte: () => ({ and: () => ({}) }), lte: () => ({}) } }
    const fake = { record: record || conflictRecord(), db }
    const original = Module._load
    Module._load = function (request) {
        if (request === 'mes-common') return { ClientError }
        if (request === './shared') {
            return {
                collection: type => 'mes_ops_' + type,
                identifier: value => String(value),
                date: value => String(value),
                text: value => String(value == null ? '' : value),
                ids: value => value || [],
                get: async (db, type, id) => fake.record && fake.record._id === String(id) ? fake.record : null,
                all: async () => [],
                and: (...conditions) => ({ conditions }),
                list: async () => ({ list: [], total: 0 }),
                save: async (db, type, id, recordData, profile, version, reason) => {
                    captured.push({ record: recordData, profile, version, reason })
                    return { ...recordData, audit: { actorId: profile.uid, actorName: profile.name, reason } }
                },
                digest: () => 'sig',
                requestId: value => value,
                expectedVersion: value => value,
                priorRequest: async () => null,
                event: (profile, type, id, signature, data) => ({ type, requestId: id, actorId: profile.uid, ...data }),
                history: async () => ({ versions: [] }),
                withScheduleLock: async (db, personId, callback) => callback()
            }
        }
        if (request === './scope') {
            return {
                active: async () => ({}),
                where: () => ({}),
                visible: () => true,
                admin: profile => { if (!profile.isAdmin) throw new ClientError('仅管理员可维护基础资料', 403); return true }
            }
        }
        if (request === './shift-time') return { shiftPeriod: () => ({}) }
        return original.apply(this, arguments)
    }
    delete require.cache[TARGET]
    try { return { module: require(TARGET), captured, fake, db } }
    finally { Module._load = original }
}

const ADMIN = { isAdmin: true, uid: 'admin', name: '管理员', personId: 'p-admin' }
const OWNER = { isAdmin: false, uid: 'u1', name: '张三', personId: 'p1' }
const OTHER = { isAdmin: false, uid: 'u2', name: '李四', personId: 'p2' }

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name); console.error('    ' + (error && error.message || error)) }
}

;(async () => {
    console.log('\n考勤冲突处理权限')

    await test('管理员处理他人冲突：成功、清空 conflict、audit actor 是管理员', async () => {
        const { module, captured, db } = load()
        const result = await module.resolveAttendanceConflict(db, ADMIN, { id: 'attendance:a1', choice: 'schedule', expectedVersion: 2, requestId: 'req-admin-1' })
        assert.equal(result.conflict, null)
        assert.equal(result.shiftName, '中班', '采用新排班')
        assert.equal(result.version, 2)
        assert.equal(captured.length, 1)
        assert.equal(captured[0].profile.uid, 'admin')
        assert.equal(captured[0].reason, '管理员处理冲突：新排班')
        assert.equal(result.audit.actorId, 'admin')
        assert.equal(result.audit.reason, '管理员处理冲突：新排班')
        assert.equal(result.event.actorId, 'admin')
    })

    await test('管理员处理他人冲突时选保留原修改，原因与结果都区分', async () => {
        const { module, captured, db } = load()
        const result = await module.resolveAttendanceConflict(db, ADMIN, { id: 'attendance:a1', choice: 'retained', expectedVersion: 2, requestId: 'req-admin-2' })
        assert.equal(result.workHours, 6, '保留原修改')
        assert.equal(captured[0].reason, '管理员处理冲突：保留原修改')
        assert.equal(result.audit.actorId, 'admin')
    })

    await test('非管理员处理他人冲突仍 403', async () => {
        const { module, captured, db } = load()
        try {
            await module.resolveAttendanceConflict(db, OTHER, { id: 'attendance:a1', choice: 'schedule', expectedVersion: 2, requestId: 'req-other' })
        } catch (error) {
            assert.equal(error.code, 403)
            assert.match(error.message, /仅管理员/)
            assert.equal(captured.length, 0)
            return
        }
        assert.fail('非管理员处理他人冲突应被拒绝')
    })

    await test('本人处理自己的冲突：原因记「员工选择…」，actor 是本人', async () => {
        const { module, captured, db } = load()
        const result = await module.resolveAttendanceConflict(db, OWNER, { id: 'attendance:a1', choice: 'retained', expectedVersion: 2, requestId: 'req-self' })
        assert.equal(result.conflict, null)
        assert.equal(captured[0].reason, '员工选择保留原修改')
        assert.equal(result.audit.actorId, 'u1')
    })

    await test('冲突已处理 / 非法选项仍按原逻辑报错', async () => {
        const done = load({ ...conflictRecord(), conflict: null })
        await assert.rejects(() => done.module.resolveAttendanceConflict(done.db, OWNER, { id: 'attendance:a1', choice: 'schedule', expectedVersion: 2, requestId: 'x' }), error => error.code === 409)
        const live = load()
        await assert.rejects(() => live.module.resolveAttendanceConflict(live.db, ADMIN, { id: 'attendance:a1', choice: 'nope', expectedVersion: 2, requestId: 'y' }), error => error.code === 400)
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
