'use strict'
const { ClientError } = require('mes-common')
const { collection, all } = require('./shared')

const MAX_RANGE_DAYS = 62
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** 严格校验 YYYY-MM-DD，拒绝 2026-02-30 这类宽松日期。 */
function validDate(value, label) {
    const text = String(value == null ? '' : value).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ClientError(label + '须为 YYYY-MM-DD', 400)
    const instant = new Date(text + 'T00:00:00Z')
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== text) throw new ClientError(label + '不是有效日期', 400)
    return text
}

/** 月份转换为当月的首尾生产日（生产日口径与 schedules.date 一致）。 */
function monthRange(month) {
    const matched = MONTH_PATTERN.exec(month)
    if (!matched) throw new ClientError('月份须为 YYYY-MM', 400)
    const year = Number(matched[1])
    const monthText = matched[2]
    const lastDay = new Date(Date.UTC(year, Number(monthText), 0)).getUTCDate()
    return { from: year + '-' + monthText + '-01', to: year + '-' + monthText + '-' + String(lastDay).padStart(2, '0') }
}

/** 支持 month 或 dateFrom/dateTo 二选一；范围最多 62 天，避免一次拉过多数据。 */
function resolveRange(input) {
    const month = String(input.month == null ? '' : input.month).trim()
    if (month) {
        if (input.dateFrom || input.dateTo) throw new ClientError('month 与 dateFrom/dateTo 只能二选一', 400)
        return monthRange(month)
    }
    const from = validDate(input.dateFrom, '开始日期')
    const to = validDate(input.dateTo, '结束日期')
    if (from > to) throw new ClientError('开始日期不能晚于结束日期', 400)
    const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1
    if (days > MAX_RANGE_DAYS) throw new ClientError('查询范围最多 ' + MAX_RANGE_DAYS + ' 天；月视图请传 month', 400)
    return { from, to }
}

function rangeCommand(db, range) {
    return db.command.gte(range.from).and(db.command.lte(range.to))
}

/**
 * 月历聚合：按生产日统计上班/休息/请假人数及各班次人数。
 * 普通账号只统计本人（mine 恒为 true）；管理员统计全量，并标记本人有排班的日期。
 * 只返回汇总数字和班次人数，不返回任何他人排班明细。
 */
async function scheduleCalendar(db, profile, input) {
    const range = resolveRange(input || {})
    // 普通账号没有可对应的人员时返回空数组，绝不能退化成「查全量」。
    if (!profile.isAdmin && !profile.personId) return { days: [] }
    const $ = db.command.aggregate
    const match = { date: rangeCommand(db, range), enabled: db.command.neq(false) }
    if (!profile.isAdmin) match.personId = profile.personId
    const grouped = ((await db.collection(collection('schedules')).aggregate()
        .match(match)
        .group({
            _id: { date: '$date', kind: '$kind', absenceType: '$absenceType', shiftId: '$shiftId' },
            count: $.sum(1)
        })
        .end()) || {}).data || []

    const shifts = await all(db, collection('shifts'), {}, 200)
    const shiftNames = new Map(shifts.map(row => [row._id, row.name]))
    const days = new Map()
    const dayOf = date => {
        if (!days.has(date)) days.set(date, { date, work: 0, rest: 0, leave: 0, shifts: new Map() })
        return days.get(date)
    }
    for (const row of grouped) {
        const key = row && row._id ? row._id : {}
        const date = String(key.date || '')
        if (!date) continue
        const count = Number(row.count) || 0
        if (count <= 0) continue
        const item = dayOf(date)
        if (key.kind === 'rest') {
            if (key.absenceType === 'leave') item.leave += count
            else item.rest += count
            continue
        }
        item.work += count
        const shiftId = String(key.shiftId || '')
        if (shiftId) item.shifts.set(shiftId, (item.shifts.get(shiftId) || 0) + count)
    }

    let myDates = null
    if (profile.isAdmin && profile.personId) {
        const own = (await db.collection(collection('schedules')).where({
            date: rangeCommand(db, range),
            enabled: db.command.neq(false),
            personId: profile.personId
        }).field({ date: true }).get()).data || []
        myDates = new Set(own.map(row => row.date))
    }

    return {
        days: [...days.values()]
            .sort((left, right) => left.date.localeCompare(right.date))
            .map(item => ({
                date: item.date,
                work: item.work,
                rest: item.rest,
                leave: item.leave,
                shifts: [...item.shifts.entries()]
                    .map(([shiftId, count]) => ({ shiftId, name: shiftNames.get(shiftId) || shiftId, count }))
                    .sort((left, right) => right.count - left.count),
                mine: profile.isAdmin ? !!(myDates && myDates.has(item.date)) : true
            }))
    }
}

module.exports = { scheduleCalendar, resolveRange, MAX_RANGE_DAYS }
