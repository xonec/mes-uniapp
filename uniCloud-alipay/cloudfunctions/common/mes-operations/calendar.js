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
 * 本人当天的一条安排摘要：工作日取最早一班作为日历格子显示；休息/请假返回 kind。
 * 多工序多班次的完整信息在 day.groups 里。
 */
function mineOf(rows) {
    const works = rows.filter(row => (row.kind || 'work') !== 'rest').sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')))
    if (works.length) {
        const row = works[0]
        return {
            kind: 'work',
            shiftId: row.shiftId || '',
            shiftName: row.shiftName || '',
            startTime: row.startTime || '',
            endTime: row.endTime || '',
            startDayOffset: Number(row.startDayOffset) || 0,
            endDayOffset: row.endDayOffset == null ? null : Number(row.endDayOffset),
            processId: row.processId || '',
            processName: row.processName || '',
            post: row.post || '',
            batchNos: [...new Set(row.batchNos || [])].sort()
        }
    }
    const rest = rows.find(row => (row.kind || 'work') === 'rest')
    if (rest) return { kind: rest.absenceType === 'leave' ? 'leave' : 'rest', shiftName: '', startTime: '', endTime: '', processName: '', post: '', batchNos: [] }
    return null
}

function groupKey(row) { return String(row.processId || '') + '|' + String(row.shiftId || '') }

/** 同一天 + 同一工序 + 同一班次 = 一组；组内按本人优先、姓名排序。 */
function buildGroups(rows, profile, processMap) {
    const groups = new Map()
    for (const row of rows) {
        if ((row.kind || 'work') === 'rest') continue
        const key = groupKey(row)
        if (!groups.has(key)) {
            groups.set(key, {
                processId: row.processId || '',
                processName: row.processName || ((processMap.get(row.processId) || {}).name || row.processId || ''),
                shiftId: row.shiftId || '',
                shiftName: row.shiftName || '',
                startTime: row.startTime || '',
                endTime: row.endTime || '',
                startDayOffset: Number(row.startDayOffset) || 0,
                endDayOffset: row.endDayOffset == null ? null : Number(row.endDayOffset),
                batchNos: new Set(),
                members: new Map()
            })
        }
        const group = groups.get(key)
        for (const batchNo of row.batchNos || []) group.batchNos.add(batchNo)
        if (row.personId && !group.members.has(row.personId)) group.members.set(row.personId, { personId: row.personId, name: row.personName || '未命名', post: row.post || '', isMe: row.personId === profile.personId })
    }
    return [...groups.values()].map(group => {
        const process = processMap.get(group.processId) || {}
        return {
            processId: group.processId,
            processName: group.processName,
            shiftId: group.shiftId,
            shiftName: group.shiftName,
            startTime: group.startTime,
            endTime: group.endTime,
            startDayOffset: group.startDayOffset,
            endDayOffset: group.endDayOffset,
            batchNos: [...group.batchNos].sort(),
            members: [...group.members.values()].sort((left, right) => Number(right.isMe) - Number(left.isMe) || left.name.localeCompare(right.name)),
            postConfigured: Array.isArray(process.posts) && process.posts.length > 0
        }
    }).sort((left, right) => Number(right.members.some(member => member.isMe)) - Number(left.members.some(member => member.isMe)) || left.processName.localeCompare(right.processName) || left.shiftName.localeCompare(right.shiftName))
}

/** 选中日的组：普通人员只返回本人参与的组；管理员/负责人按现有车间范围返回全部组。 */
async function scheduleDayOf(db, profile, day, options = {}) {
    const rows = await all(db, collection('schedules'), { date: day, enabled: db.command.neq(false) }, 20000)
    const ownRows = profile.personId ? rows.filter(row => row.personId === profile.personId) : []
    const managerScope = profile.isAdmin ? rows : profile.scopeRole === 'workshop_manager' && profile.workshopId ? rows.filter(row => row.workshopId === profile.workshopId) : null
    let candidates
    if (managerScope) candidates = managerScope
    else {
        const keys = new Set(ownRows.filter(row => (row.kind || 'work') !== 'rest').map(groupKey))
        candidates = rows.filter(row => (row.kind || 'work') !== 'rest' && keys.has(groupKey(row)))
    }
    const processMap = new Map()
    if (candidates.length) {
        const processIds = [...new Set(candidates.map(row => row.processId).filter(Boolean))]
        const processes = await all(db, collection('processes'), {}, 1000)
        for (const process of processes) if (processIds.includes(process._id)) processMap.set(process._id, process)
    }
    return { date: day, mine: mineOf(ownRows), groups: options.withGroups === false ? undefined : buildGroups(candidates, profile, processMap) }
}

/** 站内单日接口：切日期只拉这一天的组，不重拉整月。 */
async function myScheduleDay(db, profile, input) {
    const day = validDate(input && input.date, '日期')
    return scheduleDayOf(db, profile, day)
}

/** 月/周历：本人每天的班次摘要 + 组人数；传 date 时附带该日的 groups。 */
async function scheduleCalendar(db, profile, input) {
    const range = resolveRange(input || {})
    const selectedDate = input && input.date ? validDate(input.date, '日期') : ''
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

    // 本人摘要与组人数：只查本人及相关组，不拉他人明细到前端。
    const ownRows = profile.personId ? await all(db, collection('schedules'), { date: rangeCommand(db, range), enabled: db.command.neq(false), personId: profile.personId }, 20000) : []
    const mineMap = new Map()
    const ownKeysByDate = new Map()
    for (const row of ownRows) {
        if (!mineMap.has(row.date)) mineMap.set(row.date, [])
        mineMap.get(row.date).push(row)
        if ((row.kind || 'work') !== 'rest') {
            if (!ownKeysByDate.has(row.date)) ownKeysByDate.set(row.date, new Set())
            ownKeysByDate.get(row.date).add(groupKey(row))
        }
    }
    const groupCountMap = new Map()
    if (profile.personId && ownKeysByDate.size) {
        const ownWork = ownRows.filter(row => (row.kind || 'work') !== 'rest')
        const processIds = [...new Set(ownWork.map(row => row.processId).filter(Boolean))]
        const shiftIds = new Set(ownWork.map(row => row.shiftId).filter(Boolean))
        const peers = processIds.length ? await all(db, collection('schedules'), { date: rangeCommand(db, range), enabled: db.command.neq(false), processId: db.command.in(processIds) }, 20000) : []
        const membersByDayKey = new Map()
        for (const row of peers) {
            if ((row.kind || 'work') === 'rest' || !shiftIds.has(row.shiftId)) continue
            const keys = ownKeysByDate.get(row.date)
            if (!keys || !keys.has(groupKey(row))) continue
            const mapKey = row.date + '|' + groupKey(row)
            if (!membersByDayKey.has(mapKey)) membersByDayKey.set(mapKey, new Set())
            membersByDayKey.get(mapKey).add(row.personId)
        }
        for (const [date, keys] of ownKeysByDate) {
            let size = 0
            for (const key of keys) size = Math.max(size, (membersByDayKey.get(date + '|' + key) || new Set()).size)
            groupCountMap.set(date, size)
        }
    }

    const resultDays = [...days.values()]
        .sort((left, right) => left.date.localeCompare(right.date))
        .map(item => ({
            date: item.date,
            work: item.work,
            rest: item.rest,
            leave: item.leave,
            shifts: [...item.shifts.entries()]
                .map(([shiftId, count]) => ({ shiftId, name: shiftNames.get(shiftId) || shiftId, count }))
                .sort((left, right) => right.count - left.count),
            mine: mineOf(mineMap.get(item.date) || []),
            groupCount: groupCountMap.get(item.date) || 0
        }))

    if (selectedDate) {
        const selected = await scheduleDayOf(db, profile, selectedDate)
        const existing = resultDays.find(item => item.date === selectedDate)
        if (existing) existing.groups = selected.groups
        else resultDays.push({ date: selectedDate, work: 0, rest: 0, leave: 0, shifts: [], mine: selected.mine, groupCount: (selected.groups || []).length ? Math.max(...(selected.groups || []).map(group => group.members.length)) : 0, groups: selected.groups })
        resultDays.sort((left, right) => left.date.localeCompare(right.date))
    }
    return { days: resultDays }
}

module.exports = { scheduleCalendar, myScheduleDay, resolveRange, validDate, MAX_RANGE_DAYS }
