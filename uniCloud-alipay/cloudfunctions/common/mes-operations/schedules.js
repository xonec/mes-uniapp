'use strict'
const { ClientError, batchIsValid, scheduleBatchIsValid } = require('mes-common')
const { getOrderByBatch } = require('mes-document-store/order-trace')
const { collection, digest, identifier, batch, date, time, expectedVersion, requestId, text, get, all, and, list, save, stableKey, withScheduleLock } = require('./shared')
const { shiftPeriod } = require('./shift-time')
const { syncPersonAttendance } = require('./attendance')
const { active, where, visible, requireSupervisor, admin } = require('./scope')

/** 日期筛选区间为闭区间，有需要完整汇总时额外限制天数。 */
function dateRange(db, input, required = false, maximumDays = 366) {
    if (required && (!input.dateFrom || !input.dateTo)) throw new ClientError('请填写开始和结束日期', 400)
    const from = input.dateFrom ? date(input.dateFrom, '开始日期') : ''
    const to = input.dateTo ? date(input.dateTo, '结束日期') : ''
    if (from && to && (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= maximumDays)) throw new ClientError('日期范围须为最多 ' + maximumDays + ' 天，且开始不晚于结束', 400)
    return { from, to, condition: from && to ? { date: db.command.gte(from).and(db.command.lte(to)) } : from ? { date: db.command.gte(from) } : to ? { date: db.command.lte(to) } : {} }
}
/** 将排班转换为绝对分钟，午夜接续和相邻日期都能检查重叠。 */
function interval(record) {
    const base = Date.parse(record.date + 'T00:00:00Z') / 60000
    const startOffset = Number(record.startDayOffset) || 0
    const endOffset = record.endDayOffset == null ? startOffset + (record.endTime <= record.startTime ? 1 : 0) : Number(record.endDayOffset)
    const start = base + startOffset * 1440 + Number(record.startTime.slice(0, 2)) * 60 + Number(record.startTime.slice(3))
    const end = base + endOffset * 1440 + Number(record.endTime.slice(0, 2)) * 60 + Number(record.endTime.slice(3))
    return { start, end }
}
/** 排班保留完整原批次及后缀，未关联订单也可以先安排人员。 */
function scheduleBatch(value) {
    const raw = text(value, 40)
    if (!scheduleBatchIsValid(raw)) throw new ClientError('排班批次须为完整字母数字，可含连字符，不能截断后缀', 400)
    return raw
}
/** 白名单保存原表来源，文件哈希来自客户端且仅用于追溯，不作为授权凭据。 */
function scheduleImportSource(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new ClientError('排班来源格式错误', 400)
    const record = {}
    for (const [field, limit] of Object.entries({ ruleVersion: 40, fileName: 500, sheetName: 200, column: 40, rawDate: 40, rawPerson: 120, rawProcess: 200, rawBatchText: 4000, rawNote: 8000, appliedTimeRule: 500 })) {
        if (source[field] != null) record[field] = text(source[field], limit)
    }
    if (source.fileHash != null) {
        if (!/^[a-f0-9]{64}$/.test(source.fileHash)) throw new ClientError('排班文件哈希无效', 400)
        record.fileHash = source.fileHash
    }
    if (source.line != null) {
        if (!Number.isInteger(source.line) || source.line < 1) throw new ClientError('排班来源行号无效', 400)
        record.line = source.line
    }
    if (source.generated === true) {
        record.generated = true; record.date = date(source.date)
        if (!Array.isArray(source.sources) || source.sources.some(value => typeof value !== 'string' || value.length > 500)) throw new ClientError('完整日表来源无效', 400)
        record.sources = source.sources
        if (source.fileHashes != null) {
            if (!Array.isArray(source.fileHashes) || source.fileHashes.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new ClientError('完整日表来源哈希无效', 400)
            record.fileHashes = source.fileHashes
        }
    }
    return record
}
/** 保存排班引用和冻结名称；人员、工序必须属于同一车间。 */
async function saveSchedule(db, profile, input, importMeta, replacement = []) {
    const source = input.record || {}
    const version = expectedVersion(input.expectedVersion)
    const kind = source.kind || 'work'
    if (!['work', 'rest'].includes(kind)) throw new ClientError('排班类型须为工作或休息', 400)
    const record = {
        kind, date: date(source.date), shiftId: identifier(source.shiftId, '班次', kind === 'work'), processId: identifier(source.processId, '工序', kind === 'work'), personId: identifier(source.personId, '人员'),
        post: text(source.post, 80), note: text(source.note, 8000), enabled: source.enabled !== false,
        absenceType: kind === 'rest' && source.absenceType === 'leave' ? 'leave' : kind === 'rest' ? 'rest' : ''
    }
    const id = source._id ? identifier(source._id) : 'schedule:' + digest([record.date, record.shiftId, record.processId, record.personId, kind])
    const old = await get(db, 'schedules', id, false)
    if (old) visible(profile, 'schedules', old)
    if (kind === 'rest' && source.absenceType == null && old) record.absenceType = old.absenceType || 'rest'
    const person = await active(db, 'personnel', record.personId)
    const process = record.processId ? await active(db, 'processes', record.processId) : null
    const shift = record.shiftId ? await active(db, 'shifts', record.shiftId) : null
    const workshop = await active(db, 'workshops', person.workshopId)
    if ((process && process.workshopId !== workshop._id) || person.workshopId !== workshop._id) throw new ClientError('人员、工序必须属于同一车间', 400)
    record.workshopId = workshop._id; record.workshopName = workshop.name
    record.personName = person.name; record.processName = process ? process.name : ''; record.shiftName = shift ? shift.name : ''
    requireSupervisor(profile, record)
    if (record.post && (!process || (process.posts || []).length && !process.posts.includes(record.post))) throw new ClientError('所选岗位未在该工序配置，请核对', 400)
    Object.assign(record, kind === 'rest' ? { startTime: '00:00', endTime: '00:00', startDayOffset: 0, endDayOffset: 1, plannedHours: 0, crossDay: true } : shiftPeriod(source, shift))
    record.systemHours = shift ? shift.systemHours || null : null
    record.shiftSlot = shift ? shift.shiftSlot || '' : ''

    if (!Array.isArray(source.batchNos || []) || (source.batchNos || []).length > 30) throw new ClientError('排班批号须为数组且不超过 30 项', 400)
    record.batchNos = (source.batchNos || []).map(scheduleBatch)
    if (new Set(record.batchNos).size !== record.batchNos.length) throw new ClientError('排班批号有重复项', 400)
    if (kind === 'rest' && record.batchNos.length) throw new ClientError('休息记录不能关联生产批次', 400)
    record.batchLinks = []
    for (const batchNo of record.batchNos) {
        const normalized = batchNo.toUpperCase()
        const order = batchIsValid(normalized) ? await getOrderByBatch(db, normalized) : null
        const linked = order && order.enabled !== false && order.orderStatus === 'confirmed'
        record.batchLinks.push({ batchNo, status: linked ? 'linked' : 'pending', orderNo: linked ? order.orderNo : '', orderVersion: linked ? Number(order.version) || 1 : null })
    }
    if (old && old.personId !== record.personId) throw new ClientError('排班人员不能直接替换，请停用旧排班后为正确人员新建', 400)
    if (source.importSource) record.importSource = scheduleImportSource(source.importSource)
    else if (old && old.importSource) record.importSource = old.importSource
    if (importMeta) record.importMeta = importMeta
    if (old && old.importMeta && importMeta && old.importMeta.requestId === importMeta.requestId && old.importMeta.row === importMeta.row) {
        if (old.importMeta.signature !== importMeta.signature) throw new ClientError('同一导入标识中的行内容已改变，请重新导入', 409)
        await withScheduleLock(db, record.personId, () => syncPersonAttendance(db, profile, record.personId, record.date))
        return old
    }
    if (version !== (old ? old.version : 0)) throw new ClientError('排班已存在或被修改，请重新加载并核对', 409)
    return withScheduleLock(db, record.personId, async () => {
        if (record.enabled) {
            const around = new Date(record.date + 'T00:00:00Z')
            const before = new Date(around.getTime() - 86400000).toISOString().slice(0, 10)
            const after = new Date(around.getTime() + 86400000).toISOString().slice(0, 10)
            const others = await all(db, collection('schedules'), { personId: record.personId, enabled: db.command.neq(false), date: db.command.gte(before).and(db.command.lte(after)) }, 1000)
            // 完整表只暂时排除同范围、预览版本未改变的旧排班；其余排班仍检查重叠。
            const excluded = new Set()
            for (const selected of replacement) {
                const other = others.find(row => row._id === selected.id)
                if (!other || other._id === id || other.date !== record.date || other.workshopId !== record.workshopId) continue
                if (other.version !== selected.version) {
                    if (importMeta && other.importMeta && other.importMeta.sessionId === importMeta.sessionId) continue
                    throw new ClientError('旧排班在预览后发生变更，请重新核对完整表', 409)
                }
                excluded.add(other._id)
            }
            const checked = others.filter(other => !excluded.has(other._id))
            const period = interval(record)
            if (checked.some(other => other._id !== id && other.date === record.date && other.shiftId === record.shiftId && other.processId === record.processId && (other.kind || 'work') === kind)) throw new ClientError('该人员同日同班同工序已有排班，请编辑已有排班', 409)
            if (checked.some(other => {
                if (other._id === id) return false
                const otherKind = other.kind || 'work'
                if (other.date === record.date && kind !== otherKind) return true
                if (kind !== 'work' || otherKind !== 'work') return false
                const otherPeriod = interval(other)
                const shared = other.shiftId === record.shiftId && period.start === otherPeriod.start && period.end === otherPeriod.end
                return period.start < otherPeriod.end && period.end > otherPeriod.start && !shared
            })) throw new ClientError('该人员已有出勤状态或时间冲突，请调整日期或时间', 409)
        }
        const result = await save(db, 'schedules', id, record, profile, version, source.changeReason || (importMeta ? '排班表导入' : ''), previous => {
            if (previous) { visible(profile, 'schedules', previous); requireSupervisor(profile, previous) }
        })
        if (old && old.date !== record.date) await syncPersonAttendance(db, profile, record.personId, old.date)
        await syncPersonAttendance(db, profile, record.personId, record.date)
        return result
    })
}
/** 批量导入逐行反馈，重试沿用同一请求标识，不隐藏部分成功。 */
async function importSchedules(db, profile, input) {
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 200) throw new ClientError('一次导入须为 1～200 行', 400)
    const id = requestId(input.requestId)
    const sessionId = input.sessionId ? requestId(input.sessionId) : id
    const replacement = input.replacePrevious || []
    if (!Array.isArray(replacement) || replacement.length > 2000) throw new ClientError('完整表旧排班快照格式不正确', 400)
    if (replacement.length) admin(profile)
    for (const row of replacement) { identifier(row.id); expectedVersion(row.version) }
    const results = []
    for (let index = 0; index < input.rows.length; index++) {
        const source = input.rows[index] || {}
        try {
            const meta = { requestId: id, row: index + 1, signature: digest({ source, replacement, sessionId }), actorId: profile.uid, sessionId }
            const rest = source.kind === 'rest'
            const generated = 'schedule:' + digest([date(source.date), identifier(source.shiftId, '班次', !rest), identifier(source.processId, '工序', !rest), identifier(source.personId), source.kind || 'work'])
            const old = await get(db, 'schedules', source._id || generated, false)
            // 已有排班只能在传入当前版本后修改，不能由导入悄悄覆盖。
            const version = source.expectedVersion !== undefined ? source.expectedVersion : old && old.importMeta && old.importMeta.requestId === id && old.importMeta.row === index + 1 ? old.version : 0
            const record = await saveSchedule(db, profile, { record: source, expectedVersion: version }, meta, replacement)
            results.push({ row: index + 1, ok: true, record })
        } catch (error) {
            if (!(error instanceof ClientError)) throw error
            results.push({ row: index + 1, ok: false, message: error.message, code: error.code })
        }
    }
    const successCount = results.filter(result => result.ok).length
    return { results, successCount, failureCount: results.length - successCount }
}
/** 分页排班查询按照实际权限和日期范围筛选。 */
async function listSchedules(db, profile, input) {
    const range = dateRange(db, input)
    return list(db, 'schedules', input, where(db, profile, 'schedules'), ['personName', 'processName', 'workshopName', 'batchNos'], and(db, range.condition, input.includeDisabled && profile.isAdmin ? {} : { enabled: db.command.neq(false) }))
}

module.exports = { dateRange, saveSchedule, importSchedules, listSchedules }
