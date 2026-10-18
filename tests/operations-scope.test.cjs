// 生产执行 scope 的 P0 回归（node 运行：node tests/operations-scope.test.cjs）
// 覆盖：工号账号（只有 mes_employee_accounts）能解析 profile、旧 personnel 优先、
//       多份员工资料 409、无资料 403、空 workshopId 不拼空字符串过滤、
//       本人记录可见性、空车间不误判车间负责人、bootstrap 不拿空车间查字典。

const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const SCOPE = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-operations/scope.js')
const ClientError = class ClientError extends Error { constructor(message, status) { super(message); this.status = status; this.code = status } }

function makeShared() {
    return {
        collection: type => 'mes_ops_' + type,
        and: (db, ...conditions) => {
            const values = conditions.filter(value => value && Object.keys(value).length)
            return values.length > 1 ? db.command.and(values) : values[0] || {}
        },
        get: async (db, type, id) => {
            const result = await db.collection('mes_ops_' + type).doc(id).get()
            return (result.data || [])[0] || null
        },
        all: async (db, name, where = {}, maximum = 1000) => {
            const result = await db.collection(name).where(where).limit(Math.min(maximum, 200)).get()
            return result.data || []
        }
    }
}

/** 轻量内存 db：支持 profile/where/visible/bootstrap 用到的查询形态。 */
function makeDb(data) {
    const calls = []
    const value = cond => {
        if (cond === null || typeof cond !== 'object') return { eq: cond }
        if ('$neq' in cond) return { neq: cond.$neq }
        if ('$in' in cond) return { in: cond.$in }
        if ('$or' in cond) return { or: cond.$or }
        if ('$and' in cond) return { and: cond.$and }
        return { eq: cond }
    }
    const matches = (row, cond) => {
        if (!cond || !Object.keys(cond).length) return true
        return Object.keys(cond).every(key => {
            const kind = value(cond[key])
            if (kind.neq !== undefined) return row[key] !== kind.neq
            if (kind.in !== undefined) return (kind.in || []).includes(row[key])
            if (kind.or !== undefined) return kind.or.some(sub => matches(row, sub))
            if (kind.and !== undefined) return kind.and.every(sub => matches(row, sub))
            return row[key] === kind.eq
        })
    }
    const db = {
        command: {
            neq: value => ({ $neq: value }),
            in: values => ({ $in: values }),
            or: values => ({ $or: values }),
            and: values => ({ $and: values })
        },
        collection(name) {
            return {
                where(condition) {
                    calls.push({ name, condition })
                    const query = {
                        _condition: condition,
                        limit() { return query },
                        async get() {
                            return { data: (data[name] || []).filter(row => matches(row, condition)) }
                        }
                    }
                    return query
                },
                doc(id) {
                    return { async get() { return { data: (data[name] || []).filter(row => row._id === id) } } }
                }
            }
        }
    }
    return { db, calls }
}

function loadScope() {
    const original = Module._load
    Module._load = function (request) {
        if (request === 'mes-common') return { ClientError }
        if (request === 'mes-document-store/trace-fields') return { actorName: async () => '账号姓名' }
        if (request === './shared') return makeShared()
        return original.apply(this, arguments)
    }
    delete require.cache[SCOPE]
    try { return require(SCOPE) }
    finally { Module._load = original }
}

const scope = loadScope()

const EMPLOYEE = { _id: '122377', uid: 'u-emp', state: 'ready', employeeNo: '122377', name: '范海萍' }
const LEGACY_PERSON = { _id: 'ops:personnel:YG-1', uid: 'u-legacy', enabled: true, name: '老人员', code: 'YG-1', workshopId: 'w1', processIds: ['p1'], scopeRole: 'operator' }

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name); console.error('    ' + (error && error.message || error)) }
}
const rejectsWith = async (promise, code, messagePattern) => {
    try { await promise } catch (error) {
        assert.equal(error.code, code, '错误码应为 ' + code)
        if (messagePattern) assert.match(error.message, messagePattern)
        return
    }
    assert.fail('应当抛错但成功返回')
}

;(async () => {
    console.log('\n生产执行 scope（P0 工号账号回退）测试')

    await test('只有 mes_employee_accounts 的账号也能解析 profile，不再 403', async () => {
        const { db } = makeDb({ mes_employee_accounts: [EMPLOYEE] })
        const profile = await scope.profile(db, { uid: 'u-emp', role: ['user'] })
        assert.equal(profile.personId, '122377')
        assert.equal(profile.name, '范海萍')
        assert.equal(profile.employeeNo, '122377')
        assert.equal(profile.scopeRole, 'operator')
        assert.equal(profile.workshopId, '')
        assert.deepEqual(profile.processIds, [])
        assert.equal(profile.isAdmin, false)
    })

    await test('旧 personnel 记录优先，仍然使用人员档案（兼容那 1 条旧数据）', async () => {
        const { db } = makeDb({
            mes_ops_personnel: [LEGACY_PERSON],
            mes_employee_accounts: [{ ...EMPLOYEE, uid: 'u-legacy' }],
            mes_ops_workshops: [{ _id: 'w1', name: '一车间', enabled: true }]
        })
        const profile = await scope.profile(db, { uid: 'u-legacy', role: ['user'] })
        assert.equal(profile.personId, 'ops:personnel:YG-1')
        assert.equal(profile.workshopId, 'w1')
        assert.deepEqual(profile.processIds, ['p1'])
        assert.equal(profile.employeeNo, 'YG-1')
    })

    await test('同一账号命中多份员工资料 → 409 可读错误', async () => {
        const { db } = makeDb({ mes_employee_accounts: [EMPLOYEE, { ...EMPLOYEE, _id: '122378' }] })
        await rejectsWith(scope.profile(db, { uid: 'u-emp', role: ['user'] }), 409, /多份员工资料/)
    })

    await test('既无人员档案也无员工资料 → 仍 403 且文案不变', async () => {
        const { db } = makeDb({})
        await rejectsWith(scope.profile(db, { uid: 'u-none', role: ['user'] }), 403, /尚未绑定在岗人员/)
    })

    await test('where()：员工资料账号只按 personId/uid 过滤，不出现空 workshopId', async () => {
        const { db } = makeDb({})
        const profile = { uid: 'u-emp', personId: '122377', scopeRole: 'operator', workshopId: '', processIds: [], isAdmin: false }
        assert.deepEqual(scope.where(db, profile, 'schedules'), { personId: '122377' })
        assert.deepEqual(scope.where(db, profile, 'attendance'), { personId: '122377' })
        assert.deepEqual(scope.where(db, profile, 'jobs'), { personIds: { $in: ['122377'] } })
        const handovers = scope.where(db, profile, 'handovers')
        assert.deepEqual(handovers, { $or: [{ authorId: 'u-emp' }, { receiverUid: 'u-emp' }] })
        assert.equal(JSON.stringify(scope.where(db, profile, 'jobs')).includes('"workshopId":""'), false)
    })

    await test('admin 全量；有车间的旧账号仍保留车间过滤；空车间负责人不会误放全车间', async () => {
        const { db } = makeDb({})
        assert.deepEqual(scope.where(db, { isAdmin: true, workshopId: '', personId: '' }, 'jobs'), {})
        assert.deepEqual(scope.where(db, { isAdmin: false, scopeRole: 'workshop_manager', workshopId: 'w1', personId: 'p' }, 'jobs'), { workshopId: 'w1' })
        assert.deepEqual(scope.where(db, { isAdmin: false, scopeRole: 'operator', workshopId: 'w1', personId: 'p' }, 'schedules'), { workshopId: 'w1', personId: 'p' })
        assert.deepEqual(scope.where(db, { isAdmin: false, scopeRole: 'workshop_manager', workshopId: '', personId: 'p' }, 'schedules'), { personId: 'p' })
    })

    await test('visible()：员工资料账号可按本人键访问跨车间的本人记录，越权仍 403', async () => {
        const profile = { uid: 'u-emp', personId: '122377', scopeRole: 'operator', workshopId: '', processIds: [], isAdmin: false }
        const ownAttendance = { _id: 'a1', personId: '122377', workshopId: 'w9' }
        assert.equal(scope.visible(profile, 'attendance', ownAttendance), ownAttendance)
        assert.equal(scope.visible(profile, 'jobs', { _id: 'j1', personIds: ['122377'], workshopId: 'w9' })._id, 'j1')
        assert.equal(scope.visible(profile, 'handovers', { _id: 'h1', authorId: 'u-emp', receiverUid: 'x', workshopId: 'w9' })._id, 'h1')
        await rejectsWith(Promise.resolve().then(() => scope.visible(profile, 'attendance', { _id: 'a2', personId: '122378', workshopId: 'w9' })), 403, /无权访问/)
    })

    await test('supervise()：空 workshopId 不会因记录也为空而误判为车间负责人', async () => {
        assert.equal(scope.supervise({ isAdmin: false, scopeRole: 'workshop_manager', workshopId: '' }, { workshopId: '' }), false)
        assert.equal(scope.supervise({ isAdmin: false, scopeRole: 'workshop_manager', workshopId: 'w1' }, { workshopId: 'w1' }), true)
        assert.equal(scope.supervise({ isAdmin: true, workshopId: '' }, { workshopId: 'w9' }), true)
    })

    await test('bootstrap()：员工资料账号返回空基础字典，且不拿空 workshopId 查库', async () => {
        const { db, calls } = makeDb({
            mes_employee_accounts: [EMPLOYEE],
            mes_ops_shifts: [{ _id: 's1', name: '早班', enabled: true }]
        })
        const base = await scope.bootstrap(db, { uid: 'u-emp', personId: '122377', name: '范海萍', scopeRole: 'operator', workshopId: '', processIds: [], isAdmin: false })
        assert.deepEqual(base.catalogs.workshops, [])
        assert.deepEqual(base.catalogs.processes, [])
        assert.deepEqual(base.catalogs.personnel, [])
        assert.deepEqual(base.catalogs.resources, [])
        assert.equal(base.catalogs.shifts.length, 1)
        assert.equal(base.profile.personId, '122377')
        const emptyWorkshopQuery = calls.some(call => call.condition && Object.prototype.hasOwnProperty.call(call.condition, 'workshopId') && call.condition.workshopId === '')
        assert.equal(emptyWorkshopQuery, false, '不应出现 { workshopId: "" } 查询')
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
