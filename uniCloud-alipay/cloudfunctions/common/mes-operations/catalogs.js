'use strict'
const { ClientError } = require('mes-common')
const { TYPES, text, identifier, ids, get, save, expectedVersion, addImmutable } = require('./shared')
const { shiftPeriod } = require('./shift-time')
const { admin, active, effectiveScopeRole } = require('./scope')

/** 资料代码采用稳定主键，名称可更正但代码不可被悄然替换。 */
async function saveCatalog(db, profile, input) {
    admin(profile)
    const type = input.type
    if (!TYPES.includes(type)) throw new ClientError('基础资料类型非法', 400)
    const source = input.record || {}
    const code = text(source.code, 80)
    const name = text(source.name, 120)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(code)) throw new ClientError('代码须为 1～40 位字母、数字、点、下划线或短横线', 400)
    if (!name) throw new ClientError('请填写资料名称', 400)
    const id = 'ops:' + type + ':' + code
    if (source._id && identifier(source._id) !== id) throw new ClientError('资料代码创建后不能修改，请新建正确编码并停用旧资料', 400)
    const previous = await get(db, type, id, false)
    const version = expectedVersion(input.expectedVersion)
    if (version !== (previous ? previous.version : 0)) throw new ClientError('资料已被修改，请刷新后保存', 409)
    const record = { code, name, enabled: source.enabled !== false }
    if (type === 'processes') {
        record.workshopId = identifier(source.workshopId, '车间')
        record.workshopName = (await active(db, 'workshops', record.workshopId)).name
        if (!Array.isArray(source.posts) || source.posts.length > 50) throw new ClientError('岗位须为数组且不超过 50 项', 400)
        record.posts = source.posts.map(item => text(item, 80))
        if (record.posts.some(item => !item) || new Set(record.posts).size !== record.posts.length) throw new ClientError('岗位名称不能为空或重复', 400)
    }
    if (type === 'shifts') {
        Object.assign(record, shiftPeriod(source))
        record.systemHours = source.systemHours === '' || source.systemHours == null ? null : Number(source.systemHours)
        record.shiftSlot = text(source.shiftSlot, 20)
        if (record.systemHours !== null && ![8, 12].includes(record.systemHours)) throw new ClientError('班制须为 8 或 12 小时', 400)
        if (record.shiftSlot && !['early', 'middle', 'night'].includes(record.shiftSlot)) throw new ClientError('班别须为早、中或夜', 400)
        if (record.systemHours !== null && record.plannedHours !== record.systemHours) throw new ClientError('班次时间与所选班制时长不一致', 400)
        if ((record.systemHours !== null) !== !!record.shiftSlot) throw new ClientError('标准班制与班别须同时选择；自定义班次请均留空', 400)
    }
    if (type === 'personnel') {
        record.enterpriseEmployeeNo = text(source.enterpriseEmployeeNo, 60)
        record.autoCreated = previous ? !!previous.autoCreated : source.autoCreated === true
        record.workshopId = identifier(source.workshopId, '车间')
        const workshop = await active(db, 'workshops', record.workshopId)
        record.workshopName = workshop.name
        record.processIds = ids(source.processIds || [], '可用工序', 50)
        record.processNames = []
        for (const processId of record.processIds) {
            const process = await active(db, 'processes', processId)
            if (process.workshopId !== workshop._id) throw new ClientError('人员工序必须属于同一车间', 400)
            record.processNames.push(process.name)
        }
        if (!['operator', 'team_lead', 'workshop_manager'].includes(source.scopeRole)) throw new ClientError('人员职责非法', 400)
        record.scopeRole = effectiveScopeRole(source.scopeRole)
        record.uid = identifier(source.uid, '登录账号 UID', false)
        if (previous && previous.uid && previous.uid !== record.uid) throw new ClientError('已绑定账号不能替换或清空；需迁移账号时先由管理员核对人员历史', 409)
        if (record.enterpriseEmployeeNo) {
            const reserved = await addImmutable(db, 'mes_ops_bindings', { _id: 'employee-no:' + require('./shared').digest(record.enterpriseEmployeeNo), personId: id, createdAt: Date.now() })
            if (reserved.personId !== id) throw new ClientError('企业工号已被其他人员使用', 409)
        }
        if (record.uid) {
            const user = ((await db.collection('uni-id-users').doc(record.uid).field({ _id: true, status: true }).get()).data || [])[0]
            if (!user || [1, 2, 3, 4].includes(user.status)) throw new ClientError('该登录账号不存在或已失效，请从实际账号资料核对 UID', 400)
            // 固定账号唯一预留，两个管理员并发操作也不会把账号绑定给两个人。
            const binding = await addImmutable(db, 'mes_ops_bindings', { _id: 'uid:' + record.uid, personId: id, uid: record.uid, createdAt: Date.now(), createdBy: profile.uid })
            if (binding.personId !== id) throw new ClientError('此账号已关联其他人员，请核对人员档案', 409)
        }
    }
    if (type === 'resources') {
        if (!['equipment', 'mould'].includes(source.kind)) throw new ClientError('资源类型须为设备或模具', 400)
        record.kind = source.kind
        record.workshopId = identifier(source.workshopId, '车间')
        record.processId = identifier(source.processId, '工序')
        const workshop = await active(db, 'workshops', record.workshopId)
        const process = await active(db, 'processes', record.processId)
        if (process.workshopId !== workshop._id) throw new ClientError('资源工序与车间不一致', 400)
        record.workshopName = workshop.name; record.processName = process.name
        record.parameters = text(source.parameters, 4000)
    }
    return save(db, type, id, record, profile, version, source.changeReason)
}

module.exports = { saveCatalog }
