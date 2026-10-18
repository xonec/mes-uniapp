'use strict'
const { ClientError } = require('mes-common')
const { admin, active } = require('./scope')
const { saveCatalog } = require('./catalogs')
const { all, and, collection, identifier, text, digest, date, get, expectedVersion, requestId, withScheduleLock } = require('./shared')

const IMPORT_RULE_VERSION = 3

/** 拒绝旧客户端的范围协议，防止把旧范围意外扩大到整个车间。 */
function requireWorkshopImport(input) {
    if (input.teamId || input.importRuleVersion !== IMPORT_RULE_VERSION) throw new ClientError('排班导入规则已更新，请更新后台页面后重新预览', 409)
}

/** 导入前建立缺少的人员档案；同名无法唯一匹配时拒绝猜测。 */
async function prepareScheduleImport(db, profile, input) {
    admin(profile)
    requireWorkshopImport(input)
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 200) throw new ClientError('一次核对最多200人次', 400)
    const workshop = await active(db, 'workshops', identifier(input.workshopId, '导入车间'))
    const personnel = new Map()
    const rows = []
    let created = 0
    // 排班导入只建"待建号"的人员档案，不建登录账号；账号统一在后台「人员与账号」建立。
    const createdPeople = []
    for (const source of input.rows) {
        const row = { ...source }
        let person
        if (row.personId) person = await active(db, 'personnel', identifier(row.personId))
        else {
            const name = text(row.personName, 120)
            if (!name) throw new ClientError('姓名缺失，不能建立人员', 400)
            const matches = personnel.has(name) ? personnel.get(name) : (await db.collection(collection('personnel')).where(and(db,
                { workshopId: workshop._id },
                db.command.or([{ name }, { code: name }, { enterpriseEmployeeNo: name }])
            )).limit(2).get()).data || []
            personnel.set(name, matches)
            if (matches.length > 1) throw new ClientError(name + '存在同名人员，请在预览中选择唯一工号', 409)
            person = matches[0]
            if (person && person.enabled === false) throw new ClientError(name + '的档案已停用，请先核对人员', 409)
            if (!person) {
                const code = 'YG-' + digest([workshop._id, name]).slice(0, 16).toUpperCase()
                const existing = await get(db, 'personnel', 'ops:personnel:' + code, false)
                if (existing && (existing.enabled === false || existing.workshopId !== workshop._id || existing.name !== name)) throw new ClientError('自动人员编码已存在，请在预览中核对人员：' + name, 409)
                person = existing || await saveCatalog(db, profile, { type: 'personnel', expectedVersion: 0, record: { code, name, workshopId: workshop._id, processIds: [], scopeRole: 'operator', uid: '', autoCreated: true, enabled: true, changeReason: '排班新人员自动建档' } })
                personnel.set(name, [person]); created++
                if (!existing) createdPeople.push({ personId: person._id, name: person.name, code: person.code })
            }
        }
        if (person.enabled === false) throw new ClientError('人员档案已停用，请先核对：' + person.name, 409)
        if (person.workshopId !== workshop._id) throw new ClientError('人员不属于选定的车间：' + person.name, 400)
        row.personId = person._id
        const key = 'schedule:' + digest([date(row.date), row.shiftId || '', row.processId || '', row.personId, row.kind || 'work'])
        const old = await get(db, 'schedules', row._id || key, false)
        if (old && old.enabled !== false && input.replaceDay) {
            const preview = (input.previousRows || []).find(item => item.id === old._id)
            if (!preview || preview.version !== old.version) throw new ClientError('已有排班在预览后发生变化，请重新生成预览', 409)
        }
        row._id = old ? old._id : key; row.expectedVersion = old ? old.version : 0
        rows.push(row)
    }
    return { rows, created, createdPeople }
}
/** 整日完整表导入完成后，停用本车间未再出现的排班；逐项版本检查，不跨范围删除。 */
async function finishScheduleImport(db, profile, input) {
    admin(profile)
    requireWorkshopImport(input)
    const workshopId = identifier(input.workshopId, '导入车间')
    await active(db, 'workshops', workshopId)
    const productionDate = date(input.date)
    if (input.paged === true) return finishScheduleImportPage(db, profile, input, workshopId, productionDate)
    if (!Array.isArray(input.keepIds) || !input.keepIds.length || input.keepIds.length > 200) throw new ClientError('完整排班至少保留一条有效记录', 400)
    if (!Array.isArray(input.previousRows) || input.previousRows.length > 1000) throw new ClientError('完整表缺少有效旧版本快照', 400)
    for (const row of input.previousRows) { identifier(row.id); expectedVersion(row.version) }
    const keep = new Set(input.keepIds.map(id => identifier(id)))
    const rows = await all(db, collection('schedules'), { date: productionDate, workshopId, enabled: db.command.neq(false) }, 1000)
    if ([...keep].some(id => !rows.some(row => row._id === id))) throw new ClientError('导入记录不属于完整表的目标范围', 409)
    const removedRows = rows.filter(item => !keep.has(item._id))
    // 先核对所有待停用版本，避免已知冲突造成不必要的部分停用。
    for (const row of removedRows) {
        const selected = input.previousRows.find(item => item.id === row._id)
        if (!selected || selected.version !== row.version) throw new ClientError('旧排班在导入期间发生变更，请重新核对完整表', 409)
    }
    const { saveSchedule } = require('./schedules')
    const { syncPersonAttendance } = require('./attendance')
    const cursor = text(input.cursor, 180)
    const candidates = [...new Map(input.previousRows.filter(row => !keep.has(row.id)).map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id)).filter(row => !cursor || row.id.localeCompare(cursor) > 0)
    const page = candidates.slice(0, 20)
    let removed = 0
    for (const selected of page) {
        const row = await get(db, 'schedules', selected.id)
        if (row.date !== productionDate || row.workshopId !== workshopId) throw new ClientError('旧排班快照超出导入范围', 409)
        if (row.enabled === false) {
            // 上次停用成功但同步中断，重试修复考勤，不重复停用或归档。
            await withScheduleLock(db, row.personId, () => syncPersonAttendance(db, profile, row.personId, productionDate))
            continue
        }
        if (row.version !== selected.version) throw new ClientError('旧排班在导入期间发生变更，请重新核对完整表', 409)
        await saveSchedule(db, profile, { record: { ...row, enabled: false, changeReason: '完整排班重新导入：移除不再出现的人员或工序' }, expectedVersion: expectedVersion(row.version) })
        removed++
    }
    return { removed, nextCursor: candidates.length > page.length ? page[page.length - 1].id : '' }

}

/** 分页收尾只处理本次预览中的旧记录；已写入同一会话的排班由服务端保留。 */
async function finishScheduleImportPage(db, profile, input, workshopId, productionDate) {
    const sessionId = requestId(input.sessionId)
    if (!Array.isArray(input.previousRows) || !input.previousRows.length || input.previousRows.length > 20) throw new ClientError('每次收尾须提供1～20条旧排班快照', 400)
    const imported = (await db.collection(collection('schedules')).where({ workshopId, date: productionDate, enabled: db.command.neq(false), 'importMeta.sessionId': sessionId, 'importMeta.actorId': profile.uid }).limit(1).get()).data || []
    if (!imported.length) throw new ClientError('未找到本次成功导入的排班，不能移除旧排班', 409)
    const checked = []
    for (const selected of input.previousRows) {
        identifier(selected.id); expectedVersion(selected.version)
        const row = await get(db, 'schedules', selected.id)
        if (row.date !== productionDate || row.workshopId !== workshopId) throw new ClientError('旧排班快照超出导入范围', 409)
        if (row.importMeta && row.importMeta.sessionId === sessionId && row.importMeta.actorId === profile.uid) continue
        if (row.enabled !== false && row.version !== selected.version) throw new ClientError('旧排班在导入期间发生变更，请重新核对完整表', 409)
        checked.push(row)
    }
    const { saveSchedule } = require('./schedules')
    const { syncPersonAttendance } = require('./attendance')
    let removed = 0
    for (const row of checked) {
        if (row.enabled === false) {
            await withScheduleLock(db, row.personId, () => syncPersonAttendance(db, profile, row.personId, productionDate))
            continue
        }
        await saveSchedule(db, profile, { record: { ...row, enabled: false, changeReason: '完整排班分批导入：移除未再出现的人员或工序' }, expectedVersion: row.version })
        removed++
    }
    return { removed, paginationVersion: 1 }
}
/** 完整替换范围的旧版快照用于界面预览及乐观锁。 */
async function scheduleImportScope(db, profile, input) {
    admin(profile)
    requireWorkshopImport(input)
    const workshopId = identifier(input.workshopId, '导入车间')
    await active(db, 'workshops', workshopId)
    if (input.scopeType === 'personnel') {
        const cursor = input.cursor ? identifier(input.cursor, '分页位置') : ''
        const condition = { workshopId, enabled: db.command.neq(false), ...(cursor ? { _id: db.command.gt(cursor) } : {}) }
        const rows = (await db.collection(collection('personnel')).where(condition).orderBy('_id', 'asc').limit(200).get()).data || []
        return { rows: rows.map(row => ({ _id: row._id, name: row.name, code: row.code, enterpriseEmployeeNo: row.enterpriseEmployeeNo || '', workshopId, enabled: true })), nextCursor: rows.length === 200 ? rows[rows.length - 1]._id : '', paginationVersion: 1, importRuleVersion: IMPORT_RULE_VERSION }
    }
    const productionDate = date(input.date)
    if (input.paged === true) {
        const cursor = input.cursor ? identifier(input.cursor, '分页位置') : ''
        const condition = { workshopId, date: productionDate, enabled: db.command.neq(false), ...(cursor ? { _id: db.command.gt(cursor) } : {}) }
        const rows = (await db.collection(collection('schedules')).where(condition).orderBy('_id', 'asc').limit(200).get()).data || []
        return { rows: rows.map(row => ({ id: row._id, version: row.version, date: row.date, personId: row.personId, shiftId: row.shiftId, processId: row.processId, kind: row.kind || 'work', personName: row.personName, shiftName: row.shiftName, processName: row.processName, absenceType: row.absenceType || '', startTime: row.startTime, endTime: row.endTime, startDayOffset: row.startDayOffset, endDayOffset: row.endDayOffset, batchNos: row.batchNos || [], note: row.note || '' })), importRuleVersion: IMPORT_RULE_VERSION, nextCursor: rows.length === 200 ? rows[rows.length - 1]._id : '', paginationVersion: 1 }
    }
    const rows = await all(db, collection('schedules'), { workshopId, date: productionDate, enabled: db.command.neq(false) }, 1000)
    return { rows: rows.map(row => ({ id: row._id, version: row.version, personName: row.personName, shiftName: row.shiftName, processName: row.processName })) }
}
module.exports = { prepareScheduleImport, finishScheduleImport, scheduleImportScope }
