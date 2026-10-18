// 排班月历聚合（node 运行：node tests/schedule-calendar.test.cjs）
// 覆盖：按月聚合上班/休息/请假与班次人数、普通账号只见本人、管理员本人标记、
//       跨月边界、空月份、非法 month/范围 400、无人员账号不泄露数据。

const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const TARGET = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-operations/calendar.js')
const ClientError = class ClientError extends Error { constructor(message, status) { super(message); this.status = status; this.code = status } }

function makeShared() {
    return {
        collection: type => 'mes_ops_' + type,
        all: async (db, name, where = {}, maximum = 1000) => {
            const result = await db.collection(name).where(where).limit(maximum).get()
            return result.data || []
        }
    }
}

/** 取条件节点：支持 gte/lte/neq 组合与普通等值。 */
function conditionValue(node) {
    if (node === null || typeof node !== 'object') return { eq: node }
    if ('$gte' in node) return { gte: node.$gte }
    if ('$lte' in node) return { lte: node.$lte }
    if ('$neq' in node) return { neq: node.$neq }
    if ('$and' in node) return { and: node.$and }
    return { eq: node }
}
function matches(row, condition) {
    if (!condition || !Object.keys(condition).length) return true
    return Object.keys(condition).every(key => {
        const node = conditionValue(condition[key])
        if (node.gte !== undefined) return row[key] >= node.gte
        if (node.lte !== undefined) return row[key] <= node.lte
        if (node.neq !== undefined) return row[key] !== node.neq
        if (node.and !== undefined) return node.and.every(item => matches(row, { [key]: item }))
        return row[key] === node.eq
    })
}

function makeDb(data) {
    const aggregate = {
        sum: value => ({ $sum: value })
    }
    const command = {
        gte: value => ({ $gte: value, and(other) { return { $and: [{ $gte: value }, other] } } }),
        lte: value => ({ $lte: value }),
        neq: value => ({ $neq: value }),
        aggregate
    }
    const collection = name => ({
        where(condition) {
            const query = {
                _condition: condition,
                field() { return query },
                limit() { return query },
                async get() {
                    const rows = (data[name] || []).filter(row => matches(row, condition))
                    return { data: rows.map(row => ({ ...row })) }
                }
            }
            return query
        },
        aggregate() {
            const chain = {
                _match: {},
                match(condition) { chain._match = condition; return chain },
                _group: null,
                group(spec) { chain._group = spec; return chain },
                async end() {
                    const rows = (data[name] || []).filter(row => matches(row, chain._match))
                    const groups = new Map()
                    for (const row of rows) {
                        const idSpec = (chain._group && chain._group._id) || {}
                        const key = Object.fromEntries(Object.entries(idSpec).map(([field, value]) => [field, String(value).startsWith('$') ? row[String(value).slice(1)] : value]))
                        const signature = JSON.stringify(key, Object.keys(key).sort())
                        const current = groups.get(signature) || { _id: key, count: 0 }
                        const countSpec = chain._group && chain._group.count
                        const amount = countSpec && countSpec.$sum !== undefined ? countSpec.$sum : 1
                        current.count += Number(amount) || 1
                        groups.set(signature, current)
                    }
                    return { data: [...groups.values()] }
                }
            }
            return chain
        }
    })
    return { command, collection }
}

function loadCalendar() {
    const original = Module._load
    Module._load = function (request) {
        if (request === 'mes-common') return { ClientError }
        if (request === './shared') return makeShared()
        return original.apply(this, arguments)
    }
    delete require.cache[TARGET]
    try { return require(TARGET) }
    finally { Module._load = original }
}
const calendar = loadCalendar()
const { scheduleCalendar } = calendar

let passed = 0, failed = 0
async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name) }
    catch (error) { failed++; console.error('  ✗ ' + name); console.error('    ' + (error && error.message || error)) }
}
const rejectsWith = async (promise, code, pattern) => {
    try { await promise } catch (error) {
        assert.equal(error.code, code, '错误码应为 ' + code)
        if (pattern) assert.match(error.message, pattern)
        return
    }
    assert.fail('应当抛错但成功返回')
}

const SHIFTS = [
    { _id: 'shift:early', name: '早班' },
    { _id: 'shift:middle', name: '中班' }
]
/** 生成一天排班行：count 行同一班次/类型。 */
const rowsOf = (date, count, extra = {}) => Array.from({ length: count }, () => ({ date, kind: 'work', shiftId: 'shift:early', personId: 'p1', enabled: true, ...extra }))

function baseData() {
    return {
        mes_ops_shifts: SHIFTS.map(row => ({ ...row })),
        mes_ops_schedules: [
            ...rowsOf('2026-06-01', 10, { shiftId: 'shift:early' }),
            ...rowsOf('2026-06-01', 2, { shiftId: 'shift:middle' }),
            ...rowsOf('2026-06-01', 3, { kind: 'rest', shiftId: '', absenceType: 'rest' }),
            ...rowsOf('2026-06-01', 1, { kind: 'rest', shiftId: '', absenceType: 'leave' }),
            ...rowsOf('2026-06-01', 1, { enabled: false }),                    // 停用不计
            ...rowsOf('2026-06-02', 4, { personId: 'p2' }),
            ...rowsOf('2026-07-01', 1, { personId: 'p2' })                    // 跨月不计入 6 月
        ]
    }
}

;(async () => {
    console.log('\n排班月历聚合测试')

    await test('按月聚合：上班/休息/请假与班次人数正确，停用记录不计', async () => {
        const data = baseData()
        const handled = makeDb(data)
        const fakeDb = { command: handled.command, collection: handled.collection }
        const result = await scheduleCalendar(fakeDb, { isAdmin: true, personId: '' }, { month: '2026-06' })
        assert.equal(result.days.length, 2)
        const first = result.days[0]
        assert.equal(first.date, '2026-06-01')
        assert.equal(first.work, 12)
        assert.equal(first.rest, 3)
        assert.equal(first.leave, 1)
        assert.deepEqual(first.shifts.map(item => [item.shiftId, item.name, item.count]), [['shift:early', '早班', 10], ['shift:middle', '中班', 2]])
        const second = result.days[1]
        assert.equal(second.date, '2026-06-02')
        assert.equal(second.work, 4)
        assert.equal(second.shifts[0].name, '早班')
    })

    await test('普通账号只统计本人：强制按 personId 过滤，mine 恒为 true', async () => {
        const data = baseData()
        const handled = makeDb(data)
        const fakeDb = { command: handled.command, collection: handled.collection }
        const result = await scheduleCalendar(fakeDb, { isAdmin: false, personId: 'p1' }, { month: '2026-06' })
        assert.equal(result.days.length, 1, '只返回本人有排班的日期')
        const day = result.days[0]
        assert.equal(day.date, '2026-06-01')
        assert.equal(day.work, 12)
        assert.equal(day.mine, true)
        assert.equal(day.shifts.reduce((sum, item) => sum + item.count, 0), 12, '不能统计到他人记录（p2）')
    })

    await test('管理员：全量统计，只给本人有排班的日期标记 mine', async () => {
        const data = baseData()
        data.mes_ops_schedules.push(...rowsOf('2026-06-02', 1, { personId: 'p1' }))
        const handled = makeDb(data)
        const fakeDb = { command: handled.command, collection: handled.collection }
        const result = await scheduleCalendar(fakeDb, { isAdmin: true, personId: 'p1' }, { month: '2026-06' })
        const byDate = new Map(result.days.map(day => [day.date, day]))
        assert.equal(byDate.get('2026-06-01').mine, true)
        assert.equal(byDate.get('2026-06-02').mine, true)
        assert.equal(byDate.get('2026-06-02').work, 5)
    })

    await test('跨月：month 只取当月；dateFrom/dateTo 可跨月且含首尾', async () => {
        const data = baseData()
        data.mes_ops_schedules.push(...rowsOf('2026-06-30', 2), ...rowsOf('2026-07-01', 3))
        const handled = makeDb(data)
        const fakeDb = { command: handled.command, collection: handled.collection }
        const month = await scheduleCalendar(fakeDb, { isAdmin: true, personId: '' }, { month: '2026-06' })
        assert.equal(month.days.some(day => day.date.startsWith('2026-07')), false)
        assert.equal(month.days[month.days.length - 1].date, '2026-06-30')
        const range = await scheduleCalendar(fakeDb, { isAdmin: true, personId: '' }, { dateFrom: '2026-06-30', dateTo: '2026-07-01' })
        assert.deepEqual(range.days.map(day => day.date), ['2026-06-30', '2026-07-01'])
        assert.equal(range.days[1].work, 4, '7-01 原有 1 + 新增 3')
    })

    await test('空月份返回空数组', async () => {
        const handled = makeDb(baseData())
        const fakeDb = { command: handled.command, collection: handled.collection }
        const result = await scheduleCalendar(fakeDb, { isAdmin: true, personId: '' }, { month: '2026-09' })
        assert.deepEqual(result.days, [])
    })

    await test('非法 month / 日期范围返回 400', async () => {
        const handled = makeDb(baseData())
        const fakeDb = { command: handled.command, collection: handled.collection }
        const admin = { isAdmin: true, personId: '' }
        await rejectsWith(scheduleCalendar(fakeDb, admin, { month: '2026-6' }), 400, /YYYY-MM/)
        await rejectsWith(scheduleCalendar(fakeDb, admin, { month: '2026-13' }), 400, /YYYY-MM/)
        await rejectsWith(scheduleCalendar(fakeDb, admin, {}), 400, /YYYY-MM-DD/)
        await rejectsWith(scheduleCalendar(fakeDb, admin, { dateFrom: '2026-06-10', dateTo: '2026-06-01' }), 400, /不能晚于/)
        await rejectsWith(scheduleCalendar(fakeDb, admin, { dateFrom: '2026-01-01', dateTo: '2026-06-01' }), 400, /最多 62 天/)
        await rejectsWith(scheduleCalendar(fakeDb, admin, { month: '2026-06', dateFrom: '2026-06-01', dateTo: '2026-06-02' }), 400, /只能二选一/)
    })

    await test('普通账号没有人员档案时返回空数组，不退化成查全量', async () => {
        const handled = makeDb(baseData())
        const fakeDb = { command: handled.command, collection: handled.collection }
        const result = await scheduleCalendar(fakeDb, { isAdmin: false, personId: '' }, { month: '2026-06' })
        assert.deepEqual(result.days, [])
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
