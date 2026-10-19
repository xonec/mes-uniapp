'use strict'
const { ClientError } = require('mes-common')
const { all } = require('./shared')

const CATALOGS = { personnel: 'mes_ops_personnel', processes: 'mes_ops_processes', shifts: 'mes_ops_shifts', workshops: 'mes_ops_workshops' }
const MAX_WINDOW = 4000

/** 按主键批量读取，每批 100 个，避免超长 in 条件。 */
async function recordsByIds(db, name, ids) {
    const unique = [...new Set(ids.filter(value => typeof value === 'string' && value))]
    const rows = []
    for (let offset = 0; offset < unique.length; offset += 100) rows.push(...await all(db, name, { _id: db.command.in(unique.slice(offset, offset + 100)) }, 500))
    return rows
}
/** 日期偏移用于人员排班窗口，只做整日加减。 */
function shiftDate(value, days) { return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) }

/**
 * 一次批量导入的预取缓存：人员/工序/班次/车间、已有排班、人员排班窗口、批次订单都只查询一次。
 * 未预取到的键一律回退单条查询，保证与逐行实现完全相同的校验、错误和版本语义。
 */
async function createImportCache(db, options = {}) {
    const rows = options.rows || []
    const records = new Map(), absent = new Set(), windows = new Map(), orders = new Map()
    const key = (type, id) => type + ':' + id
    const put = (type, record) => { if (record && record._id) records.set(key(type, record._id), record) }
    const ids = field => [...new Set(rows.map(row => row[field]).filter(value => typeof value === 'string' && value))]
    const personIds = ids('personId'), scheduleIds = ids('_id')
    const batchNos = [...new Set(rows.flatMap(row => (row.batchNos || []).map(value => String(value).toUpperCase())))]

    const people = await recordsByIds(db, CATALOGS.personnel, personIds)
    people.forEach(record => put('personnel', record))
    for (const [type, name] of Object.entries(CATALOGS)) {
        if (type === 'personnel') continue
        for (const record of await all(db, name, {}, 2000)) put(type, record)
    }
    for (const id of personIds) if (!people.some(record => record._id === id)) absent.add(key('personnel', id))

    const existing = await recordsByIds(db, 'mes_ops_schedules', scheduleIds)
    existing.forEach(record => put('schedules', record))
    for (const id of scheduleIds) if (!existing.some(record => record._id === id)) absent.add(key('schedules', id))

    // 人员排班窗口：同一批行覆盖的日期前后各一天，用于并发时间冲突检查。
    let windowComplete = false
    const dates = [...new Set(rows.map(row => row.date).filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort()
    if (dates.length && personIds.length) {
        try {
            const list = await all(db, 'mes_ops_schedules', { personId: db.command.in(personIds), enabled: db.command.neq(false), date: db.command.gte(shiftDate(dates[0], -1)).and(db.command.lte(shiftDate(dates[dates.length - 1], 1))) }, MAX_WINDOW)
            for (const record of list) { const bucket = windows.get(record.personId) || []; bucket.push(record); windows.set(record.personId, bucket) }
            for (const id of personIds) if (!windows.has(id)) windows.set(id, [])
            windowComplete = true
        } catch (error) { if (!(error && error.code === 413)) throw error }
    }

    // 批次订单：一次查出，重复批号在取用时按原逻辑报 409。
    for (let offset = 0; offset < batchNos.length; offset += 100) {
        for (const record of await all(db, 'production_orders', { batchNo: db.command.in(batchNos.slice(offset, offset + 100)) }, 500)) {
            const bucket = orders.get(record.batchNo) || []
            bucket.push(record); orders.set(record.batchNo, bucket)
        }
    }
    for (const batchNo of batchNos) if (!orders.has(batchNo)) orders.set(batchNo, [])

    return {
        /** 目录资料：hit=false 表示未预取，调用方回退单条读取。 */
        catalog(type, id) {
            const cacheKey = key(type, id)
            if (records.has(cacheKey)) return { hit: true, record: records.get(cacheKey) }
            if (absent.has(cacheKey)) return { hit: true, record: null }
            return { hit: false }
        },
        schedule(id) {
            const cacheKey = key('schedules', id)
            if (records.has(cacheKey)) return { hit: true, record: records.get(cacheKey) }
            if (absent.has(cacheKey)) return { hit: true, record: null }
            return { hit: false }
        },
        /** 写入后同步缓存，使同一批次内的重复与时间冲突检查仍然准确。 */
        putSchedule(record) {
            if (!record || !record._id) return
            records.set(key('schedules', record._id), record)
            absent.delete(key('schedules', record._id))
            const bucket = windows.get(record.personId)
            if (!windowComplete || !bucket) return
            windows.set(record.personId, bucket.filter(row => row._id !== record._id).concat(record.enabled === false ? [] : [record]))
        },
        /** 人员排班窗口；null 表示未完整预取，调用方回退区间查询。 */
        personSchedules(personId) { return windowComplete ? windows.get(personId) || [] : null },
        /** 批次绑定的订单；null 表示未预取。 */
        orders(batchNo) { return orders.get(String(batchNo).toUpperCase()) || null }
    }
}
module.exports = { createImportCache, ClientError }
