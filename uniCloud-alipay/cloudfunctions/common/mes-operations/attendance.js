'use strict'
const { ClientError } = require('mes-common')
const { collection, identifier, date, text, ids, get, all, and, list, save, digest, requestId, expectedVersion, priorRequest, event, history, withScheduleLock } = require('./shared')
const { active, where, visible, admin } = require('./scope')
const { shiftPeriod } = require('./shift-time')

/** 月或年使用完整自然周期，包含未来预排；不将年汇总限制到一个月。 */
function attendanceRange(db, input) {
    const period = text(input.period, 10)
    let from, to
    if (input.periodType === 'year') {
        if (!/^\d{4}$/.test(period) || Number(period) < 1900 || Number(period) > 2200) throw new ClientError('请选择有效年份', 400)
        from = period + '-01-01'; to = period + '-12-31'
    } else {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ClientError('请选择月份 YYYY-MM', 400)
        from = period + '-01'; to = period + '-' + new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).getUTCDate()
    }
    return { from: date(from), to: date(to), condition: { date: db.command.gte(from).and(db.command.lte(to)) } }
}
/** 一组日期、班次和人员对应一条考勤，多工序不重复计算工时。 */
function scheduleSnapshot(rows) {
    const first = rows[0]
    const works = rows.filter(row => (row.kind || 'work') === 'work')
    const current = works[0] || first
    const period = works.length ? shiftPeriod({}, current) : { startTime: '00:00', endTime: '00:00', startDayOffset: 0, endDayOffset: 1, plannedHours: 0 }
    const processIds = [...new Set(works.map(row => row.processId))].sort()
    return { date: first.date, personId: first.personId, personName: first.personName, workshopId: first.workshopId, shiftId: first.shiftId || '', shiftName: first.shiftName || '', kind: works.length ? 'work' : 'rest', absenceType: works.length ? '' : rows.some(row => row.absenceType === 'leave') ? 'leave' : 'rest', processIds, processNames: processIds.map(id => (works.find(row => row.processId === id) || {}).processName || id), ...period, workHours: period.plannedHours, sourceRows: rows.map(row => ({ id: row._id, version: row.version })).sort((a, b) => a.id.localeCompare(b.id)), note: [...new Set(rows.map(row => row.note).filter(Boolean))].join('\n') }
}
/** 只比较业务排班内容，不因备注、版本号或重试重新制造冲突。 */
function content(row) { return { kind: row.kind, absenceType: row.kind === 'rest' ? row.absenceType || 'rest' : '', date: row.date, shiftId: row.shiftId, processIds: [...(row.processIds || [])].sort(), startTime: row.startTime, endTime: row.endTime, startDayOffset: row.startDayOffset, endDayOffset: row.endDayOffset } }
/** 排班保存后同步本人考勤；与排班共用人员租约，所有结果均带历史版本。 */
async function syncPersonAttendance(db, profile, personId, productionDate) {
    const schedules = await all(db, collection('schedules'), { personId, date: productionDate, enabled: db.command.neq(false) }, 500)
    const manual = await all(db, collection('attendance'), { personId, date: productionDate, source: 'manual' }, 500)
    const minutes = row => {
        const value = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
        return { start: (Number(row.startDayOffset) || 0) * 1440 + value(row.startTime), end: Number(row.endDayOffset) * 1440 + value(row.endTime) }
    }
    const groups = new Map()
    for (const row of schedules) { const key = row.shiftId || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row) }
    const existing = await all(db, collection('attendance'), { personId, date: productionDate, source: 'schedule' }, 500)
    const available = new Set()
    for (const [slot, rows] of groups) {
        const snapshot = scheduleSnapshot(rows)
        let id = (existing.find(row => row.sourceShiftId === slot) || {})._id || 'attendance:' + digest([personId, productionDate, slot])
        let old = await get(db, 'attendance', id, false)
        const incomingPeriod = minutes(snapshot)
        const matching = manual.filter(row => !available.has(row._id) && (snapshot.kind === 'rest' || row.kind === 'rest' || incomingPeriod.start < minutes(row).end && incomingPeriod.end > minutes(row).start))
        // 无排班时自行录入的记录随后出现在排班中，沿用原记录及其历史，不额外累计一份工时。
        if (matching.length > 1 || old && matching.length) throw new ClientError('新排班与多条既有考勤重叠，请先核对这些记录后重试同步', 409)
        if (!old && matching.length === 1) { old = matching[0]; id = old._id }
        available.add(id)
        const signature = digest(content(snapshot))
        if (old && old.sourceSignature === signature && !old.scheduleRemoved) continue
        const edited = old && (old.edited || old.conflict)
        const conflict = edited && digest(content(old.conflict ? old.conflict.retained : old)) !== signature ? { retained: old.conflict ? old.conflict.retained : { ...content(old), processNames: old.processNames, shiftName: old.shiftName, workHours: old.workHours, note: old.note }, incoming: snapshot, detectedAt: Date.now(), previousVersion: old.version } : null
        const record = { ...snapshot, source: 'schedule', sourceShiftId: slot, sourceSignature: signature, scheduleSnapshot: snapshot, originalSnapshot: old ? old.originalSnapshot || old.scheduleSnapshot || { ...content(old), processNames: old.processNames, shiftName: old.shiftName, workHours: old.workHours, note: old.note } : snapshot, status: 'recorded', edited: false, scheduleRemoved: false, conflict, event: event(profile, 'schedule_sync', 'sync-' + digest([id, signature, old ? old.version : 0]), signature) }
        await save(db, 'attendance', id, record, profile, old ? old.version : 0, conflict ? '新排班与已有修改冲突，等待员工选择整条记录' : '按排班更新考勤')
    }
    for (const old of existing) {
        if (available.has(old._id) || old.scheduleRemoved) continue
        const record = { ...old, kind: 'rest', absenceType: 'rest', processIds: [], processNames: [], workHours: 0, plannedHours: 0, startTime: '00:00', endTime: '00:00', startDayOffset: 0, endDayOffset: 1, edited: false, conflict: null, scheduleRemoved: true, status: 'recorded', event: event(profile, 'schedule_removed', 'remove-' + digest([old._id, old.version]), digest(old._id)) }
        if (old.edited || old.conflict) {
            const retained = old.conflict ? old.conflict.retained : { ...content(old), processNames: old.processNames, shiftName: old.shiftName, workHours: old.workHours, note: old.note }
            // 单班次变更将原修改转到新班次，避免旧组停用时丢失员工选择机会。
            const target = available.size === 1 ? await get(db, 'attendance', [...available][0]) : null
            if (target && !target.conflict && !target.edited) {
                const conflict = { retained, incoming: target.scheduleSnapshot, detectedAt: Date.now(), previousVersion: old.version, retainedRecordId: old._id }
                await save(db, 'attendance', target._id, { ...target, conflict }, profile, target.version, '班次变更，保留原考勤修改供员工选择')
            } else {
                record.conflict = { retained, incoming: { ...content(record), processNames: [], shiftName: record.shiftName, workHours: 0, note: record.note }, detectedAt: Date.now(), previousVersion: old.version }
            }
        }
        await save(db, 'attendance', old._id, record, profile, old.version, record.conflict ? '原班次移除，保留修改等待员工选择' : '新排班移除人员或班次，自动记休息并归零工时')
    }
}
/** 查询只读已同步考勤，管理员和主管的查看范围由服务端决定。 */
function attendanceScope(db, profile, input, own = false) {
    if (own) { if (!profile.personId) throw new ClientError('请先绑定人员档案', 403); return { personId: profile.personId } }
    if (!profile.isAdmin && profile.scopeRole !== 'workshop_manager') throw new ClientError('无权查询其他人员考勤', 403)
    return and(db, where(db, profile, 'attendance'), input.personId ? { personId: identifier(input.personId) } : {}, input.workshopId ? { workshopId: identifier(input.workshopId) } : {})
}
/** 统计出勤日去重、工时合计及工序参与次数，不输出无法确定的工序工时。 */
async function attendanceSummary(db, profile, input) {
    const range = attendanceRange(db, input)
    const rows = await all(db, collection('attendance'), and(db, attendanceScope(db, profile, input, input.own === true), range.condition), 100000)
    const people = new Map(), processes = new Map()
    for (const row of rows) {
        if (!people.has(row.personId)) people.set(row.personId, { personId: row.personId, personName: row.personName, days: new Set(), workHours: 0, processCounts: {}, recordCount: 0, conflictCount: 0 })
        const person = people.get(row.personId); person.recordCount++; if (row.conflict) person.conflictCount++
        if (row.kind !== 'work') continue
        person.days.add(row.date); person.workHours += Number(row.workHours) || 0
        for (const id of [...new Set(row.processIds || [])]) { const index = row.processIds.indexOf(id); const name = (row.processNames || [])[index] || id; person.processCounts[name] = (person.processCounts[name] || 0) + 1; if (!processes.has(id)) processes.set(id, { processId: id, name, count: 0 }); processes.get(id).count++ }
    }
    const persons = [...people.values()].map(row => ({ personId: row.personId, personName: row.personName, attendanceDays: row.days.size, workHours: Math.round(row.workHours * 100) / 100, processCounts: row.processCounts, recordCount: row.recordCount, conflictCount: row.conflictCount }))
    return { from: range.from, to: range.to, persons, processes: [...processes.values()].sort((a, b) => b.count - a.count), attendanceDays: persons.reduce((sum, row) => sum + row.attendanceDays, 0), workHours: Math.round(persons.reduce((sum, row) => sum + row.workHours, 0) * 100) / 100, conflictCount: persons.reduce((sum, row) => sum + row.conflictCount, 0) }
}
/** 主管及管理员按周期分页查看权限范围内的考勤。 */
async function listAttendance(db, profile, input) {
    const range = attendanceRange(db, input)
    return list(db, 'attendance', input, attendanceScope(db, profile, input), ['personName', 'shiftName', 'processNames'], and(db, range.condition, input.conflictOnly ? { conflict: db.command.neq(null) } : {}))
}
/** 员工本人按月份或年份查看记录，包含未来预排。 */
async function myAttendance(db, profile, input) {
    const range = attendanceRange(db, input)
    return list(db, 'attendance', input, attendanceScope(db, profile, input, true), [], range.condition)
}
/** 允许本人修改及管理员代改；用户原因可选，管理员变更必须留原因。 */
async function saveAttendance(db, profile, input) {
    const source = input.record || {}, version = expectedVersion(input.expectedVersion)
    const old = source._id ? await get(db, 'attendance', identifier(source._id)) : null
    const personId = old ? old.personId : identifier(profile.isAdmin ? source.personId : profile.personId, '人员')
    if (personId !== profile.personId) admin(profile)
    const person = await active(db, 'personnel', personId)
    const request = requestId(input.requestId), signature = digest({ source, actorId: profile.uid })
    if (old) { const accepted = await priorRequest(db, 'attendance', old, request, signature); if (accepted) return accepted }
    if (old && old.conflict) throw new ClientError('这条记录存在排班冲突，请员工先选择采用哪份', 409)
    const kind = source.kind || 'work'
    if (!['work', 'rest'].includes(kind)) throw new ClientError('请选择出勤或休息', 400)
    const shift = kind === 'work' ? await active(db, 'shifts', identifier(source.shiftId, '班次')) : null
    const processIds = kind === 'work' ? ids(source.processIds, '工序', 50) : []
    if (kind === 'work' && !processIds.length) throw new ClientError('出勤至少选择一个工序', 400)
    const processNames = []
    for (const id of processIds) { const process = await active(db, 'processes', id); if (process.workshopId !== person.workshopId) throw new ClientError('只能选择人员所在车间的工序', 403); processNames.push(process.name) }
    const period = kind === 'work' ? shiftPeriod(source, shift) : { startTime: '00:00', endTime: '00:00', startDayOffset: 0, endDayOffset: 1, plannedHours: 0 }
    const reason = text(source.changeReason, 1000)
    if (profile.isAdmin && old && !reason) throw new ClientError('管理员修改考勤请填写原因', 400)
    const id = old ? old._id : 'attendance:manual:' + digest([profile.uid, request])
    const already = !old ? await get(db, 'attendance', id, false) : null
    if (already) { if (already.event.actorId !== profile.uid || already.event.signature !== signature) throw new ClientError('同一新增请求内容不同', 409); return already }
    const record = { ...(old || {}), absenceType: kind === 'rest' && (source.absenceType == null && old ? old.absenceType : source.absenceType) === 'leave' ? 'leave' : kind === 'rest' ? 'rest' : '', date: old && old.source === 'schedule' ? old.date : date(source.date), personId, personName: person.name, workshopId: person.workshopId, kind, shiftId: shift ? shift._id : '', shiftName: shift ? shift.name : '', processIds, processNames, ...period, workHours: period.plannedHours, source: old ? old.source || 'manual' : 'manual', status: 'recorded', edited: true, note: text(source.note, 1000), event: event(profile, 'save_attendance', request, signature) }
    return withScheduleLock(db, personId, async () => {
        await checkOverlap(db, record, id)
        return save(db, 'attendance', id, record, profile, version, reason || '员工保存考勤（未填写原因）')
    })
}
/** 多班次可以同日记录，实际时间不能重叠；工序共用时间只计一次。 */
async function checkOverlap(db, record, id) {
    if (record.kind !== 'work') return
    const base = Date.parse(record.date + 'T00:00:00Z')
    const others = await all(db, collection('attendance'), { personId: record.personId, kind: 'work', date: db.command.gte(new Date(base - 86400000).toISOString().slice(0, 10)).and(db.command.lte(new Date(base + 86400000).toISOString().slice(0, 10))) }, 500)
    const interval = row => ({ start: Date.parse(row.date + 'T' + row.startTime + ':00+08:00') + (Number(row.startDayOffset) || 0) * 86400000, end: Date.parse(row.date + 'T' + row.endTime + ':00+08:00') + Number(row.endDayOffset) * 86400000 })
    const current = interval(record)
    if (others.some(row => row._id !== id && current.start < interval(row).end && current.end > interval(row).start)) throw new ClientError('与该人员其他考勤时间重叠，请调整', 409)
}
/** 冲突只由本人整条选择；新排班及保留的修改都进入历史。 */
async function resolveAttendanceConflict(db, profile, input) {
    const old = await get(db, 'attendance', identifier(input.id))
    if (old.personId !== profile.personId) throw new ClientError('请由该员工本人选择保留哪份考勤', 403)
    const request = requestId(input.requestId), signature = digest({ id: input.id, choice: input.choice, actorId: profile.uid })
    const accepted = await priorRequest(db, 'attendance', old, request, signature); if (accepted) return accepted
    if (!old.conflict) throw new ClientError('此冲突已处理，请刷新', 409)
    if (!['schedule', 'retained'].includes(input.choice)) throw new ClientError('请选择新排班或原修改', 400)
    const chosen = input.choice === 'schedule' ? old.conflict.incoming : old.conflict.retained
    const record = { ...old, ...chosen, edited: input.choice === 'retained', conflict: null, event: event(profile, 'resolve_attendance', request, signature, { choice: input.choice }) }
    return withScheduleLock(db, old.personId, async () => { await checkOverlap(db, record, old._id); return save(db, 'attendance', old._id, record, profile, expectedVersion(input.expectedVersion), '员工选择' + (input.choice === 'schedule' ? '新排班' : '保留原修改')) })
}
/** 原排班、人工修改和冲突处理均通过版本历史追溯。 */
async function attendanceHistory(db, profile, input) { const record = await get(db, 'attendance', identifier(input.id)); if (record.personId !== profile.personId) visible(profile, 'attendance', record); return { versions: await history(db, 'attendance', record) } }
/** 显式同步旧排班，用于首次部署和中断后的修复；只由管理员执行。 */
async function syncAttendance(db, profile, input) {
    admin(profile)
    const range = attendanceRange(db, input)
    if (input.periodType === 'year') throw new ClientError('补齐考勤请按月执行', 400)
    const rows = await all(db, collection('schedules'), and(db, range.condition, input.workshopId ? { workshopId: identifier(input.workshopId) } : {}, input.personId ? { personId: identifier(input.personId) } : {}), 20000)
    const cursor = text(input.cursor, 260)
    const groups = [...new Map(rows.map(row => [row.personId + ':' + row.date, row])).entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => !cursor || key.localeCompare(cursor) > 0)
    const page = groups.slice(0, 20)
    for (const [, row] of page) await withScheduleLock(db, row.personId, () => syncPersonAttendance(db, profile, row.personId, row.date))
    return { synced: page.length, nextCursor: groups.length > page.length ? page[page.length - 1][0] : '' }
}
module.exports = { attendanceRange, syncPersonAttendance, myAttendance, saveAttendance, resolveAttendanceConflict, attendanceHistory, listAttendance, attendanceSummary, syncAttendance }
