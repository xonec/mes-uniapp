'use strict'
const { ClientError } = require('mes-common')
const { digest, identifier, requestId, expectedVersion, date, ids, text, get, list, save, priorRequest, event } = require('./shared')
const { active, where, visible, supervise } = require('./scope')
const { dateRange } = require('./schedules')

/** 一个客户端创建请求对应一个实际新记录，重试不能产生第二份交班或异常。 */
async function existingCreation(db, type, id, signature, profile) {
    const old = await get(db, type, id, false)
    if (!old) return null
    visible(profile, type, old)
    if (old.createSignature !== signature || old.createdBy !== profile.uid) throw new ClientError('同一新建请求已提交不同内容，请重新加载', 409)
    return old
}
/** 保存本人交班草稿，冻结关联工单当时状态，提交后禁止修改内容。 */
async function saveHandover(db, profile, input) {
    const source = input.record || {}
    const version = expectedVersion(input.expectedVersion)
    const createRequest = source._id ? '' : requestId(input.requestId || source.requestId)
    const signature = digest({ source, actorId: profile.uid })
    const id = source._id ? identifier(source._id) : 'handover:' + digest([profile.uid, createRequest])
    if (!source._id) {
        const existing = await existingCreation(db, 'handovers', id, signature, profile)
        if (existing) return existing
    }
    const old = await get(db, 'handovers', id, false)
    if (old) {
        visible(profile, 'handovers', old)
        if (old.authorId !== profile.uid || old.status !== 'draft') throw new ClientError('只有交班本人可以修改尚未提交的草稿', 403)
    }
    const process = await active(db, 'processes', identifier(source.processId, '工序'))
    const workshop = await active(db, 'workshops', process.workshopId)
    if (!profile.isAdmin && (profile.workshopId !== workshop._id || (profile.scopeRole === 'operator' && !profile.processIds.includes(process._id)))) throw new ClientError('无权为此车间或工序交班', 403)
    const shift = await active(db, 'shifts', identifier(source.shiftId, '交班班次'))
    const nextShift = await active(db, 'shifts', identifier(source.nextShiftId, '接班班次'))
    const nextDate = date(source.nextDate || source.date, '接班日期')
    if (nextDate < source.date) throw new ClientError('接班日期不能早于交班日期', 400)
    if (shift._id === nextShift._id && nextDate === source.date) throw new ClientError('交班与接班班次不能相同', 400)
    const receiver = await active(db, 'personnel', identifier(source.receiverId, '接班人员'))
    if (!receiver.uid || receiver.uid === profile.uid) throw new ClientError('接班人员须绑定实际登录账号且不能为交班本人', 400)
    if (receiver.workshopId !== workshop._id || !(receiver.processIds || []).includes(process._id)) throw new ClientError('接班人员须属于该车间且具备此工序', 400)
    const receiverUser = ((await db.collection('uni-id-users').doc(receiver.uid).field({ status: true }).get()).data || [])[0]
    if (!receiverUser || [1, 2, 3, 4].includes(receiverUser.status)) throw new ClientError('接班人员登录账号已失效', 400)
    const jobIds = ids(source.jobIds || [], '交班工单', 30)
    const jobSnapshots = []
    for (const jobId of jobIds) {
        const job = visible(profile, 'jobs', await get(db, 'jobs', jobId))
        if (job.workshopId !== workshop._id || job.processId !== process._id) throw new ClientError('交班工单须属于所选车间和工序', 400)
        jobSnapshots.push({ _id: job._id, version: job.version, batchNo: job.batchNo, productCode: job.productCode, productName: job.productName, orderNo: job.orderNo, orderVersion: job.orderVersion, state: job.state, unit: job.unit, targetQty: job.targetQty, goodQty: job.goodQty, defectQty: job.defectQty, inboundQty: job.inboundQty, workHours: job.workHours })
    }
    const content = text(source.content, 8000)
    if (!content) throw new ClientError('请填写交班内容', 400)
    const record = {
        date: date(source.date), nextDate, shiftId: shift._id, shiftName: shift.name, nextShiftId: nextShift._id, nextShiftName: nextShift.name,
        processId: process._id, processName: process.name, workshopId: workshop._id, workshopName: workshop.name,
        receiverId: receiver._id, receiverName: receiver.name, receiverUid: receiver.uid, authorId: profile.uid, authorName: profile.name,
        jobIds, jobSnapshots, batchNos: Array.from(new Set(jobSnapshots.map(job => job.batchNo))), content,
        tailPallet: text(source.tailPallet, 4000), hygiene: text(source.hygiene, 4000), exceptions: text(source.exceptions, 4000), status: 'draft',
        createdBy: old ? old.createdBy : profile.uid, createdAt: old ? old.createdAt : Date.now(), createSignature: old ? old.createSignature : signature
    }
    return save(db, 'handovers', id, record, profile, version, source.changeReason, previous => {
        if (previous && (previous.authorId !== profile.uid || previous.status !== 'draft')) throw new ClientError('交班已提交或属于其他人员，不能修改', 403)
    })
}
/** 提交人和接收人分开确认；只有指定接班账号可以签收。 */
async function handoverCommand(db, profile, input) {
    const id = identifier(input.id)
    const current = visible(profile, 'handovers', await get(db, 'handovers', id))
    const operationId = requestId(input.requestId)
    const command = input.command
    const note = text(input.note, 2000)
    if (!['submit', 'receive'].includes(command)) throw new ClientError('交接班操作非法', 400)
    const signature = digest({ command, note, actorId: profile.uid })
    const previous = await priorRequest(db, 'handovers', current, operationId, signature)
    if (previous) return previous
    const version = expectedVersion(input.expectedVersion)
    if (version !== current.version) throw new ClientError('交班记录已变化，请重新加载后核对', 409)
    const record = { ...current }
    if (command === 'submit') {
        if (current.status !== 'draft') throw new ClientError('只有草稿可以提交交班', 409)
        if (current.authorId !== profile.uid && !supervise(profile, current)) throw new ClientError('只有交班本人或对应主管可以提交', 403)
        const receiver = await active(db, 'personnel', current.receiverId)
        if (receiver.uid !== current.receiverUid || receiver.uid === current.authorId || receiver.workshopId !== current.workshopId || !(receiver.processIds || []).includes(current.processId)) throw new ClientError('接班人员资料已变化，请交班人先重新核对草稿', 409)
        record.status = 'submitted'; record.submittedAt = Date.now(); record.submittedBy = profile.uid
    } else {
        if (current.status !== 'submitted') throw new ClientError('只有已提交的交班记录可以接班', 409)
        if (current.receiverUid !== profile.uid || current.authorId === profile.uid || current.receiverId !== profile.personId) throw new ClientError('只有指定的接班本人可以确认接班', 403)
        record.status = 'received'; record.receivedAt = Date.now(); record.receivedBy = profile.uid; record.receivedName = profile.name; record.receivedByName = profile.name; record.receiveNote = note
    }
    record.event = event(profile, command, operationId, signature, { note, date: record.date, shiftId: record.shiftId })
    return save(db, 'handovers', id, record, profile, version, note || (command === 'submit' ? '提交交班' : '本人确认接班'), old => visible(profile, 'handovers', old))
}
/** 交班列表遵循车间权限，操作员仅见本人交班和待本人接班。 */
async function listHandovers(db, profile, input) {
    if (input.status && !['draft', 'submitted', 'received'].includes(input.status)) throw new ClientError('交班状态非法', 400)
    const range = dateRange(db, input)
    const filters = { ...range.condition, ...(input.status ? { status: input.status } : {}) }
    return list(db, 'handovers', input, where(db, profile, 'handovers'), ['authorName', 'receiverName', 'processName', 'batchNos'], filters)
}
/** 异常来自可见工单，记录实际提交人；已解决的凭据禁止覆盖。 */
async function saveException(db, profile, input) {
    const source = input.record || {}
    const version = expectedVersion(input.expectedVersion)
    const createRequest = source._id ? '' : requestId(input.requestId || source.requestId)
    const signature = digest({ source, actorId: profile.uid })
    const id = source._id ? identifier(source._id) : 'exception:' + digest([profile.uid, createRequest])
    if (!source._id) {
        const existing = await existingCreation(db, 'exceptions', id, signature, profile)
        if (existing) return existing
    }
    const old = await get(db, 'exceptions', id, false)
    if (old) {
        visible(profile, 'exceptions', old)
        if (old.status !== 'open' || (old.createdBy !== profile.uid && !supervise(profile, old))) throw new ClientError('已解决异常不能修改；仅提交人或对应主管可更正', 403)
        if (source.jobId !== old.jobId) throw new ClientError('异常不能改挂其他工单，请新建正确异常', 400)
    }
    const job = visible(profile, 'jobs', await get(db, 'jobs', identifier(source.jobId, '异常工单')))
    const category = text(source.category, 80)
    const description = text(source.description, 8000)
    if (!category || !description) throw new ClientError('请填写异常分类和情况描述', 400)
    const record = {
        jobId: job._id, jobVersion: job.version, batchNo: job.batchNo, productCode: job.productCode, productName: job.productName,
        workshopId: job.workshopId, workshopName: job.workshopName, processId: job.processId, processName: job.processName,
        personIds: job.personIds, personNames: job.personNames, category, description, status: 'open', enabled: source.enabled !== false,
        createdBy: old ? old.createdBy : profile.uid, createdName: old ? old.createdName : profile.name, createdAt: old ? old.createdAt : Date.now(), createSignature: old ? old.createSignature : signature
    }
    return save(db, 'exceptions', id, record, profile, version, source.changeReason, previous => {
        if (previous && previous.status !== 'open') throw new ClientError('异常已解决，不能覆盖', 409)
    })
}
/** 解决异常须主管实际确认并填写处置结果，客户端不能伪造解决人。 */
async function resolveException(db, profile, input) {
    const id = identifier(input.id)
    const current = visible(profile, 'exceptions', await get(db, 'exceptions', id))
    if (!supervise(profile, current)) throw new ClientError('仅对应主管可确认异常已解决', 403)
    const resolution = text(input.resolution, 8000)
    if (!resolution) throw new ClientError('请填写异常处置结果', 400)
    if (current.status !== 'open') throw new ClientError('该异常已解决，请刷新查看', 409)
    const record = { ...current, status: 'resolved', resolution, resolvedAt: Date.now(), resolvedBy: profile.uid, resolvedName: profile.name }
    return save(db, 'exceptions', id, record, profile, expectedVersion(input.expectedVersion), '异常处置：' + resolution, previous => {
        visible(profile, 'exceptions', previous)
        if (!supervise(profile, previous) || previous.status !== 'open') throw new ClientError('异常状态或权限已变化，请刷新', 409)
    })
}
/** 异常列表仅查询可见工单范围内的实际异常。 */
async function listExceptions(db, profile, input) {
    if (input.status && !['open', 'resolved'].includes(input.status)) throw new ClientError('异常状态非法', 400)
    return list(db, 'exceptions', input, where(db, profile, 'exceptions'), ['batchNo', 'productName', 'category', 'description'], { enabled: db.command.neq(false), ...(input.status ? { status: input.status } : {}) })
}

/** 交班详情读取同样校验实际车间和作者、接收人范围。 */
async function getHandover(db, profile, input) { return visible(profile, 'handovers', await get(db, 'handovers', identifier(input.id))) }

module.exports = { saveHandover, handoverCommand, listHandovers, getHandover, saveException, resolveException, listExceptions }
