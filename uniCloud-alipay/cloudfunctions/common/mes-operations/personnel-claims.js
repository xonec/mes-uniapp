'use strict'
const { ClientError } = require('mes-common')
const { actorName } = require('mes-document-store/trace-fields')
const { admin, active } = require('./scope')
const { saveCatalog } = require('./catalogs')
const { identifier, text, digest, collection, all, get, list, save, expectedVersion, withScheduleLock } = require('./shared')

/** 尚未绑定的已登录员工仅能查询最少的认领信息，不能访问人员账号资料。 */
async function claimCandidates(db, auth, input) {
    const keyword = text(input.keyword, 80)
    if (!keyword) return { list: [] }
    const bound = await all(db, collection('personnel'), { uid: auth.uid, enabled: db.command.neq(false) }, 2)
    if (bound.length) throw new ClientError('当前账号已绑定人员档案', 409)
    const result = await list(db, 'personnel', { keyword, pageSize: 20 }, { enabled: db.command.neq(false), uid: '' }, ['name', 'code', 'enterpriseEmployeeNo'])
    return { list: result.list.map(row => ({ _id: row._id, name: row.name, code: row.code, workshopName: row.workshopName })), total: result.total }
}
/** 一账号一份认领申请，管理员审核前不赋予员工数据权限。 */
async function requestPersonnelClaim(db, auth, input) {
    const person = await active(db, 'personnel', identifier(input.personId))
    if (person.uid) throw new ClientError('该档案已绑定账号，请管理员核对', 409)
    const uid = auth.uid
    const bound = await all(db, collection('personnel'), { uid, enabled: db.command.neq(false) }, 2)
    if (bound.length) throw new ClientError('当前账号已绑定人员档案', 409)
    const id = 'claim:' + digest(uid)
    const old = await get(db, 'claims', id, false)
    if (old && old.status === 'pending') { if (old.personId === person._id) return old; throw new ClientError('已有待审核申请，请先等待管理员处理', 409) }
    const profile = { uid, name: await actorName(db, uid), isAdmin: false }
    const record = { uid, accountName: profile.name, personId: person._id, personName: person.name, employeeNo: person.code, workshopId: person.workshopId, workshopName: person.workshopName, status: 'pending', note: text(input.note, 1000), requestedAt: Date.now() }
    return save(db, 'claims', id, record, profile, old ? old.version : 0, '员工申请认领人员档案')
}
/** 当前账号只读取自己的认领申请。 */
async function myPersonnelClaim(db, auth) { const record = await get(db, 'claims', 'claim:' + digest(auth.uid), false); return { record } }
/** 管理员按申请状态分页审核，包含申请人唯一账号标识。 */
async function listPersonnelClaims(db, profile, input) { admin(profile); return list(db, 'claims', input, {}, ['personName', 'employeeNo', 'accountName'], input.status ? { status: text(input.status, 30) } : {}) }
/** 批准时沿用人员绑定的唯一预留与CAS校验，失败不会把认领申请标成已通过。 */
async function reviewPersonnelClaim(db, profile, input) {
    admin(profile)
    const old = await get(db, 'claims', identifier(input.id))
    if (!['approved', 'rejected'].includes(input.decision)) throw new ClientError('请选择通过或拒绝', 400)
    if (old.status === input.decision) return old
    if (old.status !== 'pending' || expectedVersion(input.expectedVersion) !== old.version) throw new ClientError('申请已被处理，请刷新', 409)
    const reason = text(input.reason, 1000)
    if (input.decision === 'rejected' && !reason) throw new ClientError('拒绝认领请填写原因', 400)
    return withScheduleLock(db, old.personId, async () => {
        const current = await get(db, 'claims', old._id)
        if (current.status === input.decision) return current
        if (current.status !== 'pending' || current.version !== old.version) throw new ClientError('申请已被处理，请刷新', 409)
        if (input.decision === 'approved') {
            const person = await active(db, 'personnel', old.personId)
            if (person.uid && person.uid !== old.uid) throw new ClientError('该档案已被其他账号绑定', 409)
            if (!person.uid) await saveCatalog(db, profile, { type: 'personnel', expectedVersion: person.version, record: { ...person, uid: old.uid, changeReason: '审核通过员工认领申请' } })
        }
        return save(db, 'claims', old._id, { ...old, status: input.decision, reviewedAt: Date.now(), reviewedBy: profile.uid, reviewReason: reason }, profile, old.version, reason || '管理员审核通过')
    })
}
module.exports = { claimCandidates, requestPersonnelClaim, myPersonnelClaim, listPersonnelClaims, reviewPersonnelClaim }
