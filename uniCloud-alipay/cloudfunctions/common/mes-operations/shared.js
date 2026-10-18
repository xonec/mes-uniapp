'use strict'
const { createHash, randomBytes } = require('crypto')
const { ClientError, batchIsValid } = require('mes-common')
const { saveVersioned, stableKey, updatedCount } = require('mes-document-store')
const { addImmutable, duplicate } = require('mes-document-store/source-store')
const { text, actorName, changes } = require('mes-document-store/trace-fields')

const TYPES = ['workshops', 'processes', 'shifts', 'personnel', 'resources']
const MAX_READ = 4000
const VERSIONS = 'mes_ops_versions'

/** 只允许模块维护的集合类型，避免客户端指定任意集合。 */
function collection(type) {
    // teams 仅供管理员查阅历史版本，不再提供资料维护入口。
    if (![...TYPES, 'teams', 'schedules', 'jobs', 'handovers', 'exceptions', 'attendance', 'claims'].includes(type)) throw new ClientError('资料类型非法', 400)
    return 'mes_ops_' + type
}
/** 稳定主键用于重试和自然唯一键。 */
function digest(value) { return createHash('sha256').update(stableKey(value)).digest('hex') }
/** 校验长度有限的实际标识，拒绝对象和模糊匹配。 */
function identifier(value, label = '记录标识', required = true) {
    if (typeof value !== 'string' || !value.trim() || value.length > 220) {
        if (!required && (value == null || value === '')) return ''
        throw new ClientError(label + '缺失或非法', 400)
    }
    return value.trim()
}
/** 校验完整生产批号，绝不通过前缀猜测产品。 */
function batch(value) {
    const valueText = text(value, 40).toUpperCase()
    if (!batchIsValid(valueText)) throw new ClientError('请输入完整生产批号（含 B 单后缀）', 400)
    return valueText
}
/** 校验真实公历日期，原始业务日期不接受宽松转换。 */
function date(value, label = '日期') {
    const valueText = text(value, 20)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) throw new ClientError(label + '须为 YYYY-MM-DD', 400)
    const instant = new Date(valueText + 'T00:00:00Z')
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== valueText) throw new ClientError(label + '不是有效日期', 400)
    return valueText
}
/** 时间仅允许 24 小时制，跨日由开始和结束关系决定。 */
function time(value, label = '时间') {
    const valueText = text(value, 10)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valueText)) throw new ClientError(label + '须为 HH:mm', 400)
    return valueText
}
/** 数量不补默认值；只接受有限、非负业务数字。 */
function quantity(value, label, positive = false, maximum = 1000000000) {
    if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'object') throw new ClientError(label + '缺失', 400)
    const result = Number(value)
    if (!Number.isFinite(result) || result < 0 || (positive && result <= 0) || result > maximum) throw new ClientError(label + (positive ? '须为正数' : '须为非负数'), 400)
    if (Math.abs(result * 1000000 - Math.round(result * 1000000)) > 0.0001) throw new ClientError(label + '最多保留 6 位小数', 400)
    return result
}
/** 累计数字限制精度，避免浮点误差逐次放大。 */
function plus(left, right) { return Math.round((Number(left || 0) + Number(right || 0)) * 1000000) / 1000000 }
/** 必须明确提交版本，更新和新建均执行乐观锁。 */
function expectedVersion(value) {
    if (!Number.isInteger(value) || value < 0) throw new ClientError('请携带有效的当前版本，重新加载后保存', 409)
    return value
}
/** 幂等键只由调用方生成一次，每次重试沿用原值。 */
function requestId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(value)) throw new ClientError('操作请求标识缺失或非法，请重新发起操作', 400)
    return value
}
/** 数组必须逐项校验，拒绝截断造成悄然漏项。 */
function ids(value, label, maximum = 100) {
    if (!Array.isArray(value) || value.length > maximum) throw new ClientError(label + '须为数组且不超过 ' + maximum + ' 项', 400)
    const result = value.map(item => identifier(item, label))
    if (new Set(result).size !== result.length) throw new ClientError(label + '有重复项，请核对', 400)
    return result
}
/** 查询主键记录，数据不存在时给出可处理的业务错误。 */
async function get(db, type, id, required = true) {
    const rows = (await db.collection(collection(type)).doc(identifier(id)).get()).data || []
    if (!rows[0] && required) throw new ClientError('记录不存在，请刷新', 404)
    return rows[0] || null
}
/** 有上限地读取完整结果；超限明确报错，不把截断当作完整汇总。 */
async function all(db, name, where = {}, maximum = MAX_READ, orderField = '_id') {
    const result = []
    for (let offset = 0; offset <= maximum; offset += 200) {
        let query = db.collection(name).where(where).orderBy(orderField, 'asc')
        if (orderField !== '_id') query = query.orderBy('_id', 'asc')
        const page = (await query.skip(offset).limit(Math.min(200, maximum + 1 - offset)).get()).data || []
        result.push(...page)
        if (result.length > maximum) throw new ClientError('结果过多，请缩小日期范围或筛选条件后重试', 413)
        if (page.length < Math.min(200, maximum + 1 - offset)) break
    }
    return result
}
/** 集合查询条件只由服务端组装，独立条件使用 AND 组合。 */
function and(db, ...conditions) {
    const values = conditions.filter(value => value && Object.keys(value).length)
    return values.length > 1 ? db.command.and(values) : values[0] || {}
}
/** 保留分页元信息，关键字按字面量匹配，权限条件始终参与查询。 */
async function list(db, type, event, scope = {}, fields = ['name'], filters = {}) {
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(event.pageSize) || 20)))
    const keyword = text(event.keyword, 80)
    const search = keyword ? db.command.or(fields.map(field => ({ [field]: db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) }))) : {}
    const where = and(db, scope, filters, search)
    const coll = db.collection(collection(type))
    const counted = await coll.where(where).count()
    const rows = (await coll.where(where).orderBy('updatedAt', 'desc').orderBy('_id', 'asc').skip((page - 1) * pageSize).limit(pageSize).get()).data || []
    return { list: rows, total: counted.total || 0, page, pageSize }
}
/** 业务内容和服务端审计一并写入 CAS 版本，不存在独立事件插入窗口。 */
async function save(db, type, id, record, profile, version, reason, authorizeChange) {
    expectedVersion(version)
    const business = { ...record, entityType: type }
    delete business._id; delete business.version; delete business.audit; delete business.updatedAt; delete business.updatedBy; delete business.changeReason
    const signature = source => stableKey(Object.fromEntries(Object.keys(business).map(key => [key, source[key] === undefined ? null : source[key]])))
    const name = profile.name || await actorName(db, profile.uid)
    let result
    try {
        result = await saveVersioned(db, {
            collection: collection(type), versions: VERSIONS, keyField: 'entityId', key: id, id,
            record: business, uid: profile.uid, expectedVersion: version, signature,
            authorizeChange: old => {
                if (old && signature(old) !== signature(business) && !text(reason, 1000)) throw new ClientError('修改资料请填写原因，便于追溯', 400)
                if (authorizeChange) authorizeChange(old)
            },
            audit: (old, nextVersion) => ({ actorId: profile.uid, actorName: name, at: Date.now(), reason: text(reason, 1000) || '首次录入', action: old ? 'update' : 'create', previousVersion: old ? old.version : 0, version: nextVersion, changedFields: changes(old, business, stableKey).map(item => item.field) })
        })
    } catch (error) {
        if (duplicate(error)) throw new ClientError('唯一编码、账号或排班组合已存在，请刷新核对', 409)
        throw error
    }
    // 当前记录可能已经被其他操作继续推进，返回本次实际接受版本。
    const current = await get(db, type, id)
    if (current.version === result.version) return current
    const archived = ((await db.collection(VERSIONS).doc('ver:' + id + ':' + result.version).get()).data || [])[0]
    if (archived && archived.snapshot) return archived.snapshot
    throw new ClientError('保存结果已变化，请刷新当前记录', 409)
}
/** 只有已接受当前版本之前的归档才属于操作历史，失败 CAS 不产生额外事件。 */
async function history(db, type, record) {
    const archived = await all(db, VERSIONS, { entityId: record._id, version: db.command.lt(record.version) }, 2000, 'version')
    return [...archived.map(item => item.snapshot).filter(Boolean), record].sort((left, right) => left.version - right.version)
}
/** 从已接受快照读取幂等操作结果，相同请求不重复累计数量。 */
async function priorRequest(db, type, current, id, signature) {
    const currentEvent = current.event
    const found = currentEvent && currentEvent.requestId === id ? current : ((await db.collection(VERSIONS).where({ entityId: current._id, version: db.command.lt(current.version), 'snapshot.event.requestId': id }).limit(2).get()).data || []).map(item => item.snapshot).find(Boolean)
    if (!found) return null
    if (!found.event || found.event.signature !== signature) throw new ClientError('同一请求标识已提交不同内容，请刷新核对', 409)
    return found
}
/** 生成完整服务端事件，不信任客户端操作人或时间。 */
function event(profile, type, id, signature, data = {}) {
    return { ...data, type, requestId: id, signature, at: Date.now(), actorId: profile.uid, actorName: profile.name }
}
/** 对同一员工的排班写入加租约，防止两次并发提交绕过时间重叠检查。 */
async function withScheduleLock(db, personId, callback) {
    const id = 'schedule-person:' + digest(personId)
    const owner = randomBytes(16).toString('hex')
    const expiresAt = Date.now() + 600000
    const lock = await addImmutable(db, 'mes_ops_locks', { _id: id, owner, expiresAt })
    if (lock.owner !== owner) {
        const count = updatedCount(await db.collection('mes_ops_locks').where({ _id: id, expiresAt: db.command.lte(Date.now()) }).update({ owner, expiresAt }))
        if (!count) throw new ClientError('该人员排班正在保存，请稍后重试', 409)
    }
    try { return await callback() }
    finally { await db.collection('mes_ops_locks').where({ _id: id, owner }).update({ expiresAt: 0 }).catch(error => console.warn('[mes-operations] 排班租约释放失败', error.message)) }
}

module.exports = { TYPES, MAX_READ, VERSIONS, collection, digest, identifier, batch, date, time, quantity, plus, expectedVersion, requestId, ids, get, all, and, list, save, history, priorRequest, event, withScheduleLock, text, stableKey, addImmutable }
