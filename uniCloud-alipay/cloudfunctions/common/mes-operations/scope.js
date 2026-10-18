'use strict'
const { ClientError } = require('mes-common')
const { actorName } = require('mes-document-store/trace-fields')
const { get, all, collection, and } = require('./shared')

/** 旧职责按操作员处理，由管理员重新分配车间管理职责。 */
function effectiveScopeRole(role) { return role === 'workshop_manager' ? role : 'operator' }

/** 以当前人员绑定和实际 uni-id 管理员角色确定本次数据范围。 */
async function profile(db, auth) {
    const bound = (await db.collection(collection('personnel')).where({ uid: auth.uid, enabled: db.command.neq(false) }).limit(2).get()).data || []
    if (bound.length > 1) throw new ClientError('登录账号关联多个在岗人员，请管理员核对', 409)
    const person = bound[0] || null
    const isAdmin = (auth.role || []).includes('admin')
    // P0 兼容：工号账号由 createEmployeeAccount 建号时只写 mes_employee_accounts，
    // 没有 mes_ops_personnel 档案。先走原人员路径，查不到再回退员工资料，避免这类账号登录即 403。
    let employee = null
    if (!person) {
        const employees = (await db.collection('mes_employee_accounts').where({ uid: auth.uid, state: 'ready' }).limit(2).get()).data || []
        if (employees.length > 1) throw new ClientError('同一账号关联多份员工资料，请管理员核对', 409)
        employee = employees[0] || null
    }
    if (!isAdmin && !person && !employee) throw new ClientError('账号尚未绑定在岗人员，请管理员在基础资料中绑定登录账号', 403)
    // 旧人员路径仍校验车间；员工资料账号没有车间归属，空车间跳过。
    if (person && !isAdmin && person.workshopId) await active(db, 'workshops', person.workshopId)
    if (employee && !person) {
        return { uid: auth.uid, personId: employee._id, name: employee.name || await actorName(db, auth.uid), employeeNo: employee.employeeNo || '', scopeRole: isAdmin ? 'admin' : 'operator', workshopId: '', processIds: [], isAdmin }
    }
    return { uid: auth.uid, personId: person ? person._id : '', name: person ? person.name : await actorName(db, auth.uid), employeeNo: person ? person.code || '' : '', scopeRole: isAdmin ? 'admin' : effectiveScopeRole(person.scopeRole), workshopId: person ? person.workshopId : '', processIds: person ? person.processIds || [] : [], isAdmin }
}
/** 所有新引用须存在且启用，历史冻结名称不受后续停用影响。 */
async function active(db, type, id) {
    const record = await get(db, type, id)
    if (record.enabled === false) throw new ClientError('所选资料已停用，请重新选择', 400)
    return record
}
/** 基础资料修改只由真实管理员执行。 */
function admin(profile) { if (!profile.isAdmin) throw new ClientError('仅管理员可维护基础资料', 403) }
/** 判断该车间是否落在当前负责人授权范围内。 */
function supervise(profile, record) {
    if (profile.isAdmin) return true
    // 空车间（员工资料账号）不参与车间级授权，避免 '' === '' 误判为负责人。
    if (profile.scopeRole === 'workshop_manager' && profile.workshopId && record && record.workshopId === profile.workshopId) return true
    return false
}
/** 查询权限始终在服务端叠加，不依赖前端隐藏按钮。 */
function where(db, profile, type) {
    if (profile.isAdmin) return {}
    // 员工资料账号没有车间归属：只按本人 personId / uid 过滤，不能拼 { workshopId: '' }。
    const ownScope = profile.workshopId ? { workshopId: profile.workshopId } : {}
    if (profile.scopeRole === 'workshop_manager' && profile.workshopId) return { workshopId: profile.workshopId }
    if (type === 'schedules' || type === 'attendance') return { ...ownScope, personId: profile.personId }
    if (type === 'handovers') return and(db, ownScope, db.command.or([{ authorId: profile.uid }, { receiverUid: profile.uid }]))
    return { ...ownScope, personIds: db.command.in([profile.personId]) }
}
/** 单条读取也必须进行同一范围校验，避免通过已知主键越权。 */
function visible(profile, type, record) {
    if (!record) throw new ClientError('记录不存在', 404)
    if (supervise(profile, record)) return record
    // 有车间归属时保持原车间边界；无车间（员工资料账号）只按本人键判断。
    const sameWorkshop = !profile.workshopId || record.workshopId === profile.workshopId
    let allowed = false
    if (type === 'schedules' || type === 'attendance') allowed = record.personId === profile.personId
    else if (type === 'handovers') allowed = record.authorId === profile.uid || record.receiverUid === profile.uid
    else allowed = (record.personIds || []).includes(profile.personId)
    if (!sameWorkshop || !allowed) throw new ClientError('无权访问此车间或本人职责范围外的记录', 403)
    return record
}
/** 普通人员只允许操作分配给自己的工单，负责人按车间范围操作。 */
function operate(profile, job) {
    visible(profile, 'jobs', job)
    if (!supervise(profile, job) && !profile.processIds.includes(job.processId)) throw new ClientError('当前人员已不具备此工序权限，请联系负责人调整派工', 403)
    return job
}
/** 排班和派工属于主管权限，不允许操作员自派工。 */
function requireSupervisor(profile, record) {
    if (!supervise(profile, record)) throw new ClientError('仅对应车间负责人或管理员可排班派工', 403)
}
/** 返回实际资料字典；普通用户只读取自己可用的车间和工序范围。 */
async function bootstrap(db, profile) {
    const activeWhere = { enabled: db.command.neq(false) }
    const catalogs = {}
    if (profile.isAdmin) {
        for (const type of ['workshops', 'processes', 'shifts', 'personnel', 'resources']) catalogs[type] = await all(db, collection(type), {}, 1000)
    } else {
        // 员工资料账号没有车间：基础字典返回空，不拿空字符串去匹配车间。
        if (profile.workshopId) {
            catalogs.workshops = await all(db, collection('workshops'), { _id: profile.workshopId, ...activeWhere }, 1000)
            catalogs.processes = await all(db, collection('processes'), { workshopId: profile.workshopId, ...activeWhere }, 1000)
            catalogs.personnel = await all(db, collection('personnel'), { workshopId: profile.workshopId, ...activeWhere }, 1000)
            catalogs.resources = await all(db, collection('resources'), and(db, activeWhere, { workshopId: profile.workshopId }, profile.scopeRole === 'operator' ? { processId: db.command.in(profile.processIds) } : {}), 1000)
        } else {
            catalogs.workshops = []
            catalogs.processes = []
            catalogs.personnel = []
            catalogs.resources = []
        }
        catalogs.shifts = await all(db, collection('shifts'), activeWhere, 1000)
    }
    catalogs.personnel = catalogs.personnel.map(person => {
        const { teamId, teamName, ...current } = person
        return { ...current, scopeRole: effectiveScopeRole(person.scopeRole) }
    })
    // 账号绑定只给管理员显示；员工字典不泄露其他人员的登录账号标识。
    if (!profile.isAdmin) catalogs.personnel = catalogs.personnel.map(person => { const { uid, bindingRequestId, ...safe } = person; return { ...safe, accountBound: !!uid, isSelf: uid === profile.uid } })
    const { uid, ...publicProfile } = profile
    return { profile: publicProfile, catalogs }
}

module.exports = { profile, effectiveScopeRole, active, admin, supervise, where, visible, operate, requireSupervisor, bootstrap }
