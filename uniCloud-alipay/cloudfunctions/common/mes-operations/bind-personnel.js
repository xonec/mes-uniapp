'use strict'
const { ClientError } = require('mes-common')
const { updatedCount } = require('mes-document-store')
const { collection, all } = require('./shared')

const EMPLOYEE_COLL = 'mes_employee_accounts'
const PERSONNEL_COLL = 'mes_ops_personnel'
const VERSIONS = 'mes_ops_versions'
const REASON = '按员工档案绑定登录账号'

/** 姓名匹配只做“去空白后精确匹配”，不做拼音/模糊/前缀猜测。 */
function nameKey(name) {
    return String(name == null ? '' : name).replace(/\s+/g, '')
}

function groupByName(rows) {
    const groups = new Map()
    for (const row of rows) {
        const key = nameKey(row.name)
        if (!key) continue
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
    }
    return groups
}

/**
 * 一次性把「员工档案里的账号」绑定到同名且唯一的旧人员档案上。
 * 只按姓名精确匹配；多义、找不到、已绑不同账号一律跳过，不猜。
 * dryRun 只出计划；每次绑定把旧快照归档到 mes_ops_versions 并写 audit，可重复执行。
 */
async function bindPersonnelAccounts(db, profile, input = {}) {
    if (!profile.isAdmin) throw new ClientError('仅管理员可执行人员账号绑定', 403)
    const dryRun = input.dryRun === true
    const employees = (await all(db, EMPLOYEE_COLL, { state: 'ready' }, 5000)).filter(row => row.uid)
    const personnel = await all(db, collection('personnel'), {}, 5000)
    const employeeGroups = groupByName(employees)
    const result = { dryRun, totalEmployee: employees.length, totalPersonnel: personnel.length, bound: 0, skipped: [], ambiguous: [] }
    const handledNames = new Set()

    for (const person of personnel) {
        const key = nameKey(person.name)
        if (!key) { result.skipped.push({ personId: person._id, name: person.name || '', reason: '人员姓名为空' }); continue }
        const matchedEmployees = employeeGroups.get(key) || []
        if (!matchedEmployees.length) { if (!person.uid) result.skipped.push({ personId: person._id, name: person.name, reason: '员工档案中找不到同名账号' }); continue }
        // 员工侧同名多条：无法判断是哪一位，跳过并汇总到 ambiguous。
        if (matchedEmployees.length > 1) {
            if (!result.ambiguous.includes(key)) result.ambiguous.push(key)
            result.skipped.push({ personId: person._id, name: person.name, reason: '员工档案中存在多位同名人员，无法唯一匹配' })
            continue
        }
        const employee = matchedEmployees[0]
        if (person.uid) {
            // 已绑定：同一账号视为幂等，不同账号不擅自覆盖。
            if (person.uid === employee.uid) result.skipped.push({ personId: person._id, name: person.name, reason: '已绑定相同账号，无需重复' })
            else result.skipped.push({ personId: person._id, name: person.name, reason: '人员档案已绑定其他账号，需人工核对', boundUid: person.uid, employeeUid: employee.uid })
            continue
        }
        // 人员侧同名多条：同样无法唯一判断。
        const sameNamePersonnel = personnel.filter(item => nameKey(item.name) === key && !item.uid)
        if (sameNamePersonnel.length > 1) {
            if (!result.ambiguous.includes(key)) result.ambiguous.push(key)
            result.skipped.push({ personId: person._id, name: person.name, reason: '人员档案中存在多位同名人员，无法唯一匹配' })
            continue
        }
        handledNames.add(key)
        if (dryRun) { result.bound++; result.skipped.push({ personId: person._id, name: person.name, reason: 'dryRun：计划绑定', planUid: employee.uid }); continue }

        const now = Date.now()
        const previousVersion = Number(person.version) || 1
        const nextVersion = previousVersion + 1
        // 先归档旧快照（备份），归档失败就不改主档。
        await db.collection(VERSIONS).doc('ver:' + person._id + ':' + previousVersion).set({
            _id: 'ver:' + person._id + ':' + previousVersion,
            entityId: person._id,
            entityType: 'personnel',
            version: previousVersion,
            savedAt: new Date(person.updatedAt || now).toISOString(),
            updatedBy: person.updatedBy || '',
            snapshot: person
        })
        const updated = updatedCount(await db.collection(PERSONNEL_COLL).where({ _id: person._id, version: person.version === undefined ? db.command.exists(false) : person.version }).update({
            uid: employee.uid,
            version: nextVersion,
            updatedAt: now,
            updatedBy: profile.uid,
            audit: {
                actorId: profile.uid,
                actorName: profile.name || '',
                at: now,
                reason: REASON,
                action: 'update',
                previousVersion,
                version: nextVersion,
                changedFields: ['uid']
            }
        }))
        if (!updated) { result.skipped.push({ personId: person._id, name: person.name, reason: '人员档案已被修改，请重试' }); continue }
        result.bound++
    }

    return result
}

module.exports = { bindPersonnelAccounts }
