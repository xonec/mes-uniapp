'use strict'
const { ClientError } = require('mes-common')
const { getOrderByBatch } = require('mes-document-store/order-trace')
const { collection, digest, identifier, batch, date, expectedVersion, requestId, quantity, plus, ids, text, get, list, save, history, priorRequest, event, stableKey } = require('./shared')
const { active, where, visible, operate, requireSupervisor } = require('./scope')

const UNITS = ['bottle', 'case', 'piece']
const STATES = ['planned', 'running', 'paused', 'completed']

/** 工单从实际确认订单创建，冻结采用的产品、材料、上托和订单版本。 */
async function createJob(db, profile, input) {
    const source = input.record || {}
    if (expectedVersion(input.expectedVersion) !== 0) throw new ClientError('创建工单请使用新建版本 0', 409)
    const batchNo = batch(source.batchNo)
    const process = await active(db, 'processes', identifier(source.processId, '工序'))
    const workshop = await active(db, 'workshops', process.workshopId)
    requireSupervisor(profile, { workshopId: workshop._id })
    const personIds = ids(source.personIds || [], '分配人员', 100)
    if (!personIds.length) throw new ClientError('请至少分配一位在岗人员', 400)
    const personNames = []
    for (const personId of personIds) {
        const person = await active(db, 'personnel', personId)
        if (person.workshopId !== workshop._id || !(person.processIds || []).includes(process._id)) throw new ClientError('分配人员须属于该车间且具备此工序', 400)
        personNames.push(person.name)
    }
    const order = await getOrderByBatch(db, batchNo)
    if (!order || order.enabled === false || order.orderStatus !== 'confirmed' || order.batchNo !== batchNo) throw new ClientError('该完整批号没有启用的正式生产订单，请先确认订单', 400)
    if (!UNITS.includes(source.unit)) throw new ClientError('工单单位须为瓶、箱或件，请明确选择', 400)
    // 计划数必须由派工人明确填写；不能把订单中另一个单位的数量当作兜底。
    const targetQty = quantity(source.targetQty, '工单计划数', true)
    const id = 'job:' + digest([batchNo, process._id])
    const old = await get(db, 'jobs', id, false)
    if (old) { visible(profile, 'jobs', old); throw new ClientError('该批号与工序已创建工单，请打开现有工单继续', 409) }
    const record = {
        batchNo, productCode: order.productCode, productName: order.productName,
        orderNo: order.orderNo, orderVersion: Number(order.version) || 1, orderSnapshot: order,
        processId: process._id, processName: process.name, workshopId: workshop._id, workshopName: workshop.name,
        personIds, personNames, targetQty, unit: source.unit, plannedDate: date(source.plannedDate, '计划日期'),
        state: 'planned', goodQty: 0, defectQty: 0, inboundQty: 0, workHours: 0, equipmentId: '', equipmentName: '', mouldId: '', mouldName: '', startParameters: '',
        createdAt: Date.now(), createdBy: profile.uid
    }
    record.event = event(profile, 'create', 'create:' + digest(id), digest(record), { note: text(source.changeReason, 1000) || '首次派工', date: record.plannedDate, unit: record.unit })
    return save(db, 'jobs', id, record, profile, 0, source.changeReason || '首次派工')
}
/** 返回工单和全部已接受事件；历史内容只读、数量不重新推算替换原始凭据。 */
async function getJob(db, profile, input) {
    const job = visible(profile, 'jobs', await get(db, 'jobs', identifier(input.id)))
    const snapshots = await history(db, 'jobs', job)
    const seen = new Set()
    const events = snapshots.map(snapshot => snapshot.event ? { ...snapshot.event, version: snapshot.version } : null).filter(item => {
        if (!item || seen.has(item.requestId)) return false
        seen.add(item.requestId); return true
    }).sort((left, right) => right.version - left.version)
    return { job, events }
}
/** 严格状态转换和幂等操作，事件与业务累计同时进入一个 CAS 版本。 */
async function jobCommand(db, profile, input) {
    const id = identifier(input.id)
    const current = operate(profile, await get(db, 'jobs', id))
    const operationId = requestId(input.requestId)
    const command = input.command
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {}
    if (!['start', 'pause', 'resume', 'report', 'inbound', 'complete'].includes(command)) throw new ClientError('工单操作非法', 400)
    const signature = digest({ command, payload, actorId: profile.uid })
    const previous = await priorRequest(db, 'jobs', current, operationId, signature)
    if (previous) return previous
    const version = expectedVersion(input.expectedVersion)
    if (version !== current.version) throw new ClientError('工单已被他人操作，请刷新后核对', 409)
    const record = { ...current }
    const note = text(payload.note, 2000)
    const data = { note, unit: current.unit }
    let reason = note
    if (command === 'start') {
        if (current.state !== 'planned') throw new ClientError('只有待开工工单可以开工', 409)
        for (const [field, kind] of [['equipmentId', 'equipment'], ['mouldId', 'mould']]) {
            const resourceId = identifier(payload[field], kind === 'equipment' ? '设备' : '模具', false)
            if (resourceId) {
                const resource = await active(db, 'resources', resourceId)
                if (resource.kind !== kind || resource.workshopId !== current.workshopId || resource.processId !== current.processId) throw new ClientError('开工设备或模具与工单工序、车间不一致', 400)
                record[field] = resource._id; record[field.replace('Id', 'Name')] = resource.name
            }
        }
        if (payload.parameters != null && typeof payload.parameters !== 'string') throw new ClientError('开工参数请填写文本', 400)
        record.startParameters = text(payload.parameters, 4000)
        record.state = 'running'; record.startedAt = Date.now()
        Object.assign(data, { equipmentId: record.equipmentId, equipmentName: record.equipmentName, mouldId: record.mouldId, mouldName: record.mouldName, parameters: record.startParameters })
        reason = note || '工单开工'
    }
    if (command === 'pause' || command === 'resume') {
        if (!note) throw new ClientError('请填写' + (command === 'pause' ? '暂停' : '继续') + '原因', 400)
        if (command === 'pause' && current.state !== 'running') throw new ClientError('只有生产中的工单可以暂停', 409)
        if (command === 'resume' && current.state !== 'paused') throw new ClientError('只有暂停的工单可以继续', 409)
        record.state = command === 'pause' ? 'paused' : 'running'
    }
    if (command === 'report') {
        if (!['running', 'paused'].includes(current.state)) throw new ClientError('请开工后报产；完工工单不能追加报产', 409)
        const shift = await active(db, 'shifts', identifier(payload.shiftId, '报产班次'))
        const goodQty = quantity(payload.goodQty, '合格数量')
        const defectQty = quantity(payload.defectQty, '不良数量')
        const workHours = quantity(payload.workHours, '工时', false, 48)
        if (!goodQty && !defectQty && !workHours) throw new ClientError('报产数量与工时不能全部为零', 400)
        const reportDate = date(payload.date, '报产日期')
        const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
        if (reportDate > today) throw new ClientError('不能把未来日期录为实际报产', 400)
        Object.assign(data, { date: reportDate, shiftId: shift._id, shiftName: shift.name, shiftSnapshot: { startTime: shift.startTime, endTime: shift.endTime, startDayOffset: Number(shift.startDayOffset) || 0, endDayOffset: shift.endDayOffset == null ? (shift.endTime <= shift.startTime ? 1 : 0) : Number(shift.endDayOffset), systemHours: shift.systemHours || null, version: shift.version }, goodQty, defectQty, workHours })
        record.goodQty = plus(current.goodQty, goodQty); record.defectQty = plus(current.defectQty, defectQty); record.workHours = plus(current.workHours, workHours)
        reason = note || '班次实际报产'
    }
    if (command === 'inbound') {
        if (!['running', 'paused', 'completed'].includes(current.state)) throw new ClientError('待开工工单不能确认生产入库', 409)
        const qty = quantity(payload.qty, '生产入库确认数量', true)
        if (plus(current.inboundQty, qty) > Number(current.goodQty || 0)) throw new ClientError('累计生产入库确认数量不能超过已报合格数，请先核对报产', 400)
        const inboundDate = payload.date ? date(payload.date, '入库确认日期') : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
        if (inboundDate > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) throw new ClientError('不能确认未来日期的生产入库', 400)
        const documentNo = text(payload.documentNo, 120)
        Object.assign(data, { qty, date: inboundDate, documentNo })
        record.inboundQty = plus(current.inboundQty, qty)
        reason = note || '生产入库数量确认'
    }
    if (command === 'complete') {
        if (!['running', 'paused'].includes(current.state)) throw new ClientError('只有已开工的工单可以完工', 409)
        if (!note) throw new ClientError('请填写完工说明', 400)
        if (!current.goodQty && !current.defectQty) throw new ClientError('请先报实际产量，再确认完工', 400)
        record.state = 'completed'; record.completedAt = Date.now()
    }
    record.event = event(profile, command, operationId, signature, data)
    return save(db, 'jobs', id, record, profile, version, reason, old => {
        operate(profile, old)
        if (old.version !== version) throw new ClientError('工单版本已变化，请刷新', 409)
    })
}
/** 列表不接受任意状态，保证权限条件始终参与实际数据库查询。 */
async function listJobs(db, profile, input) {
    if (input.state && !STATES.includes(input.state)) throw new ClientError('工单状态非法', 400)
    return list(db, 'jobs', input, where(db, profile, 'jobs'), ['batchNo', 'productCode', 'productName', 'processName', 'workshopName'], input.state ? { state: input.state } : {})
}

module.exports = { UNITS, createJob, getJob, jobCommand, listJobs }
