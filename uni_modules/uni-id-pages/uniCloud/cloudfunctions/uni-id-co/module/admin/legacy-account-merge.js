const { createHash, randomBytes } = require('crypto')
const { db, userCollection } = require('../../common/constants')

const MERGES = 'mes_account_merges'
const BACKUPS = 'mes_account_merge_backups'
// 本次仅处理用户已核对的六组；测试账号和无法对应的人员不进入操作范围。
const PAIRS = [
  ['fanhaiping', '122377', '范海萍'], ['yujiayuan', '124720', '于家园'],
  ['luyeqin', '123898', '陆业钦'], ['zhuzhao', '121361', '朱钊'],
  ['dinglei', '127557', '丁磊'], ['jiangxiaohui', '122777', '蒋小辉']
]
// 只迁移当前归属字段。audit、event、importMeta及历史快照中的原操作人保持不变。
const OWNERS = {
  production_records: ['savedBy'], production_orders: ['savedBy', 'updatedBy'],
  production_batch_orders: ['createdBy'], batch_buckets: ['savedBy'],
  product_bom: ['updatedBy'], product_materials: ['updatedBy'],
  packaging_plans: ['updatedBy'], mes_customers: ['updatedBy'], config: ['updatedBy'],
  production_drafts: ['uid'], mes_ops_personnel: ['uid'], mes_ops_bindings: ['uid'],
  mes_ops_claims: ['uid'], mes_ops_handovers: ['authorId', 'receiverUid', 'createdBy'],
  mes_ops_exceptions: ['createdBy'], mes_ops_attendance: ['updatedBy'],
  mes_ops_schedules: ['updatedBy'], mes_ops_jobs: ['updatedBy'],
  mes_ops_workshops: ['updatedBy'], mes_ops_processes: ['updatedBy'],
  mes_ops_resources: ['updatedBy'], mes_ops_shifts: ['updatedBy'], mes_ops_teams: ['updatedBy'],
  source_documents: ['createdBy'], source_image_assets: ['createdBy'],
  source_upload_leases: ['uid'], 'uni-id-device': ['user_id'],
  'opendb-news-articles': ['user_id'], 'opendb-news-comments': ['user_id', 'reply_user_id'],
  'opendb-news-favorite': ['user_id'], 'opendb-search-log': ['user_id'],
  'read-news-log': ['user_id'], 'uni-id-scores': ['user_id']
}
const PROFILE_FIELDS = ['avatar', 'avatar_file', 'mobile', 'mobile_confirmed', 'email', 'email_confirmed', 'comment', 'department_id', 'gender']
const LOGIN_FIELDS = ['wx_openid', 'wx_unionid', 'ali_openid', 'apple_openid', 'qq_openid', 'qq_unionid', 'third_party']
const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length) || (value && typeof value === 'object' && !Object.keys(value).length)
function fail(message) { throw { errCode: 'EMPLOYEE_MERGE_ERROR', errMsg: message } }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const opsDigest = value => hash(value) // mes-operations 的 digest 使用稳定 JSON。
const data = result => (result && result.data || [])[0] || null
const changed = result => Number(result && (result.updated ?? result.affectedDocs ?? result.modifiedCount) || 0)
const removed = result => Number(result && (result.deleted ?? result.affectedDocs ?? result.deletedCount) || 0)
async function get(name, id) { return data(await db.collection(name).doc(id).get()) }
/** 员工档案按 employeeNo 字段查（新模型 _id 是稳定 id，不再等于工号）。 */
async function employeeByNo(employeeNo) {
  const found = (await db.collection('mes_employee_accounts').where({ employeeNo }).limit(2).get()).data || []
  if (found.length > 1) fail('工号存在多条员工资料，请人工核对')
  return found[0] || null
}
function absentTable(error) { return /(?:collection|table|集合|数据表).*(?:does not exist|not exist|不存在)|(?:not found).*(?:collection|table)/i.test(String(error && (error.errMsg || error.message) || '')) }
async function rows(name, where) {
  const found = []
  try {
    for (let offset = 0; ; offset += 100) {
      const page = (await db.collection(name).where(where).orderBy('_id', 'asc').skip(offset).limit(100).get()).data || []
      found.push(...page)
      if (page.length < 100) return found
    }
  } catch (error) { if (absentTable(error)) return []; throw error }
}
/** 管理权限同时核对token和数据库当前角色，管理员账号永不进入迁移。 */
async function admin(context) {
  await context.middleware.auth()
  const user = data(await userCollection.doc(context.authInfo.uid).get())
  if (!user || !(user.role || []).includes('admin') || [1, 2, 3, 4].includes(user.status)) fail('仅有效管理员可合并账号')
}
function pairFor(input) {
  const pair = PAIRS.find(item => item[0] === input.sourceUsername && item[1] === input.employeeNo)
  if (!pair) fail('此账号不在已确认的六组对应关系内')
  return pair
}
function safeUser(user) {
  const { token, uni_id_token, ...saved } = user
  return saved
}
function keyFor(name, record, uid) {
  if (name === 'production_drafts') return 'draft:' + uid + ':' + record.deviceId + ':' + record.batchNo
  if (name === 'mes_ops_bindings' && record.uid) return 'uid:' + uid
  if (name === 'mes_ops_claims') return 'claim:' + opsDigest(uid)
  return record._id
}
async function scan(uid) {
  const result = []
  // 并行只读查询；结果统一排序，避免漏页和预览签名漂移。
  const entries = Object.entries(OWNERS)
  for (let offset = 0; offset < entries.length; offset += 4) {
    const groups = await Promise.all(entries.slice(offset, offset + 4).map(async ([name, fields]) => {
      const found = await rows(name, db.command.or(fields.map(field => ({ [field]: uid }))))
      return found.map(record => ({ collection: name, record, fields: fields.filter(field => record[field] === uid) }))
    }))
    result.push(...groups.flat())
  }
  return result.sort((a, b) => (a.collection + ':' + a.record._id).localeCompare(b.collection + ':' + b.record._id))
}
async function quotas(uid) {
  const escaped = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return rows('ocr_quota', { _id: db.RegExp({ regexp: '^u:.*:' + escaped + '$', options: '' }) })
}
async function accounts(pair, context) {
  const [sourceUsername, employeeNo, name] = pair
  const sources = (await userCollection.where({ username: sourceUsername }).limit(2).get()).data || []
  const targets = (await userCollection.where({ username: employeeNo }).limit(2).get()).data || []
  if (sources.length !== 1 || targets.length !== 1) fail('来源或目标账号缺失/重复，请重新核对')
  const source = sources[0], target = targets[0]
  if (source._id === target._id || [source, target].some(user => user._id === context.authInfo.uid || (user.role || []).includes('admin'))) fail('禁止合并或删除管理员账号')
  if (!(source.role || []).includes('user') || source.nickname !== name || target.nickname !== name) fail('原账号角色或双方姓名与确认清单不一致')
  if ([1, 2, 3, 4].includes(target.status)) fail('新工号账号不可用')
  const employee = await employeeByNo(employeeNo)
  if (!employee || employee.state !== 'ready' || employee.uid !== target._id || employee.name !== name) fail('目标员工资料与账号关联不一致')
  return { source, target, employee }
}
function profilePatch(source, target, conflicts) {
  const patch = {}
  for (const field of LOGIN_FIELDS) if (!empty(source[field])) conflicts.push('原账号存在第三方登录绑定：' + field + '，需单独核对')
  for (const field of PROFILE_FIELDS) {
    if (empty(source[field]) || source[field] === 0) continue
    if (empty(target[field]) || target[field] === 0) patch[field] = source[field]
    else if (hash(source[field]) !== hash(target[field])) conflicts.push('双方账号资料不同：' + field)
  }
  if (Number(source.score || 0) !== 0 || Number(target.score || 0) !== 0) conflicts.push('账号含积分余额，需先单独核对')
  const tags = [...new Set([...(target.tags || []), ...(source.tags || [])])]
  if (hash(tags) !== hash(target.tags || [])) patch.tags = tags
  return patch
}
async function plan(pair, context) {
  const { source, target } = await accounts(pair, context)
  const affected = await scan(source._id), conflicts = []
  const patch = profilePatch(source, target, conflicts)
  const oldPersonnel = affected.filter(item => item.collection === 'mes_ops_personnel')
  const newPersonnel = await rows('mes_ops_personnel', { uid: target._id })
  // 旧账号无人员档案时无需迁移，目标账号已有档案属正常情况；
  // 仅当旧账号有多条档案、或目标档案不是旧档案之一（会被替换）时才算冲突。
  if (oldPersonnel.length > 1 || (oldPersonnel.length && newPersonnel.some(person => !oldPersonnel.some(item => item.record._id === person._id)))) conflicts.push('人员档案绑定冲突，不能自动替换')
  const operations = []
  for (const item of affected) {
    const targetId = keyFor(item.collection, item.record, target._id)
    if (targetId !== item.record._id && await get(item.collection, targetId)) conflicts.push(item.collection + '已有相同主键的目标记录，不能覆盖')
    if (item.collection === 'source_upload_leases' && item.record.expiresAt > Date.now()) conflicts.push('原账号有未结束的图片上传，请稍后重试')
    operations.push({ collection: item.collection, id: item.record._id, targetId, fields: item.fields, beforeHash: hash(item.record), version: item.record.version ?? null })
  }
  const counts = affected.reduce((all, item) => { all[item.collection] = (all[item.collection] || 0) + 1; return all }, {})
  const quotaRows = await quotas(source._id)
  for (const quota of quotaRows) operations.push({ kind: 'quota', collection: 'ocr_quota', id: quota._id, targetId: quota._id.slice(0, -source._id.length) + target._id, fields: [], beforeHash: hash(quota), version: null })
  if (quotaRows.length) counts.ocr_quota = quotaRows.length
  const signature = hash({ source: safeUser(source), target: safeUser(target), operations, patch })
  return { source, target, operations, patch, counts, conflicts, signature }
}
function summary(ledger) {
  return { sourceUsername: ledger.sourceUsername, employeeNo: ledger.employeeNo, name: ledger.name, mergeId: ledger._id, state: ledger.state, completed: ledger.cursor || 0, total: ledger.operations.length, counts: ledger.counts, message: ledger.state === 'complete' ? '已合并并删除原账号' : '迁移备份已保存，可安全续传' }
}
/** 只读预览当前数据归属、资料差异和冲突；不禁用、修改或删除账号。 */
async function previewLegacyAccountMerge(input = {}) {
  await admin(this)
  const pair = pairFor(input)
  const previous = (await rows(MERGES, { sourceUsername: pair[0], employeeNo: pair[1] }))[0]
  if (previous) return { errCode: 0, ...summary(previous) }
  const planned = await plan(pair, this)
  return { errCode: 0, sourceUsername: pair[0], employeeNo: pair[1], name: pair[2], state: planned.conflicts.length ? 'conflict' : 'ready', counts: planned.counts, total: planned.operations.length, profileFields: Object.keys(planned.patch), conflicts: planned.conflicts, planHash: planned.signature }
}
/** 保存迁移清单和账号备份后停用原账号，防止迁移期间继续产生新归属。 */
async function startLegacyAccountMerge(input = {}) {
  await admin(this)
  const pair = pairFor(input)
  const previous = (await rows(MERGES, { sourceUsername: pair[0], employeeNo: pair[1] }))[0]
  if (previous) return { errCode: 0, ...summary(previous) }
  const planned = await plan(pair, this)
  if (planned.conflicts.length || input.planHash !== planned.signature) fail('预览后资料已变化或存在冲突，请重新预览')
  const id = 'merge:' + planned.source._id
  const ledger = { _id: id, sourceUsername: pair[0], employeeNo: pair[1], name: pair[2], sourceUid: planned.source._id, targetUid: planned.target._id, sourceBackup: safeUser(planned.source), targetBackup: safeUser(planned.target), operations: planned.operations, counts: planned.counts, profilePatch: planned.patch, cursor: 0, state: 'prepared', createdAt: Date.now(), createdBy: this.authInfo.uid, lockOwner: '', lockUntil: 0 }
  await db.collection(MERGES).add(ledger)
  return { errCode: 0, ...summary(ledger) }
}
async function readLedger(input, context) {
  const ledger = await get(MERGES, input.mergeId)
  if (!ledger || !PAIRS.some(pair => pair[0] === ledger.sourceUsername && pair[1] === ledger.employeeNo && pair[2] === ledger.name)) fail('迁移清单非法')
  if (ledger.sourceUid === context.authInfo.uid || ledger.targetUid === context.authInfo.uid) fail('禁止操作当前管理员账号')
  return ledger
}
async function backup(ledger, operation, record) {
  const id = 'backup:' + hash([ledger._id, operation.collection, operation.id])
  const old = await get(BACKUPS, id)
  if (old) { if (old.beforeHash !== operation.beforeHash) fail('迁移备份与清单不一致'); return }
  await db.collection(BACKUPS).add({ _id: id, mergeId: ledger._id, collection: operation.collection, sourceId: operation.id, targetId: operation.targetId, beforeHash: operation.beforeHash, record, createdAt: Date.now() })
}
async function move(ledger, operation) {
  const coll = db.collection(operation.collection)
  const old = await get(operation.collection, operation.id)
  const already = await get(operation.collection, operation.targetId)
  const trace = value => value && value.accountMerge && value.accountMerge.mergeId === ledger._id
  if (trace(already) && operation.targetId !== operation.id) {
    if (old) {
      if (hash(old) !== operation.beforeHash) fail('待删除的原记录发生变化，已停止')
      await coll.doc(operation.id).remove()
    }
    return
  }
  if (trace(old)) return
  if (!old || hash(old) !== operation.beforeHash) fail('迁移记录发生变化，已停止：' + operation.collection)
  await backup(ledger, operation, old)
  if (operation.kind === 'quota') {
    if (!Number.isFinite(old.calls) || old.calls < 0) fail('原OCR额度计数非法，未合并')
    const accountMerge = { mergeId: ledger._id, sourceUid: ledger.sourceUid, sourceCalls: old.calls, at: ledger.createdAt }
    if (already) {
      if (!Number.isFinite(already.calls) || already.calls < 0) fail('目标OCR额度计数非法，未覆盖')
      await backup(ledger, { ...operation, id: operation.targetId, beforeHash: hash(already) }, already)
      if (changed(await coll.where({ _id: already._id, calls: already.calls }).update({ calls: db.command.inc(old.calls), accountMerge })) !== 1) fail('OCR额度计数发生并发变化，请重试')
    } else await coll.add({ ...old, _id: operation.targetId, accountMerge })
    const saved = await get(operation.collection, operation.targetId)
    if (!trace(saved)) fail('OCR额度回读失败，保留原计数')
    if (removed(await coll.where({ _id: old._id, calls: old.calls }).remove()) !== 1) fail('原OCR计数发生变化，未删除')
    return
  }
  const patch = Object.fromEntries(operation.fields.map(field => [field, ledger.targetUid]))
  patch.accountMerge = { mergeId: ledger._id, sourceUid: ledger.sourceUid, sourceUsername: ledger.sourceUsername, targetUid: ledger.targetUid, at: ledger.createdAt }
  if (operation.targetId !== operation.id) {
    if (already) fail('目标主键已存在，已停止，未覆盖')
    await coll.add({ ...old, ...patch, _id: operation.targetId })
    const saved = await get(operation.collection, operation.targetId)
    if (!trace(saved)) fail('目标记录回读失败，原记录保留')
    await coll.doc(operation.id).remove()
  } else {
    const where = { _id: old._id, ...Object.fromEntries(operation.fields.map(field => [field, ledger.sourceUid])) }
    if (operation.version !== null) where.version = operation.version
    if (changed(await coll.where(where).update(patch)) !== 1) fail('归属更新冲突，已停止：' + operation.collection)
  }
}
/** 每次至多迁移八条记录，保存游标；断网后从已保存的备份继续。 */
async function continueLegacyAccountMerge(input = {}) {
  await admin(this)
  let ledger = await readLedger(input, this)
  if (['readyToDelete', 'complete'].includes(ledger.state)) return { errCode: 0, ...summary(ledger) }
  const owner = randomBytes(16).toString('hex'), now = Date.now()
  const lock = await db.collection(MERGES).where({ _id: ledger._id, lockUntil: db.command.lte(now) }).update({ lockOwner: owner, lockUntil: now + 55000 })
  if (changed(lock) !== 1) fail('该账号正在迁移，请稍后重试')
  try {
    const { source, target } = await accounts(pairFor(ledger), this)
    if (source._id !== ledger.sourceUid || target._id !== ledger.targetUid) fail('账号UID与清单不一致')
    if (ledger.state === 'prepared') {
      const stopped = await userCollection.where({ _id: source._id, username: ledger.sourceUsername, role: db.command.neq('admin') }).update({ status: 1, valid_token_date: now + 1000, token: [] })
      if (changed(stopped) !== 1) fail('原账号未能停用，未迁移业务数据')
      ledger.state = 'migrating'
      await db.collection(MERGES).doc(ledger._id).update({ state: ledger.state })
    }
    const end = Math.min(ledger.cursor + 8, ledger.operations.length)
    while (ledger.cursor < end) {
      await move(ledger, ledger.operations[ledger.cursor])
      ledger.cursor++
      await db.collection(MERGES).doc(ledger._id).update({ cursor: ledger.cursor })
    }
    if (ledger.cursor === ledger.operations.length) {
      if ((await scan(ledger.sourceUid)).length || (await quotas(ledger.sourceUid)).length) fail('原账号仍有新出现的数据归属，已停止删除，请核对')
      const current = data(await userCollection.doc(ledger.targetUid).get())
      for (const key of Object.keys(ledger.profilePatch)) {
        const before = ledger.targetBackup[key]
        if (hash(current[key] ?? null) !== hash(before ?? null) && hash(current[key] ?? null) !== hash(ledger.profilePatch[key])) fail('目标账号资料已变化，未覆盖：' + key)
      }
      if (Object.keys(ledger.profilePatch).length) await userCollection.doc(ledger.targetUid).update(ledger.profilePatch)
      ledger.state = 'readyToDelete'
      await db.collection(MERGES).doc(ledger._id).update({ state: ledger.state, verifiedAt: Date.now() })
    }
    return { errCode: 0, ...summary(ledger) }
  } finally { await db.collection(MERGES).where({ _id: ledger._id, lockOwner: owner }).update({ lockUntil: 0 }) }
}
/** 仅在全部归属完成且回读通过后删除原普通账号，保留私人备份和迁移映射。 */
async function finalizeLegacyAccountMerge(input = {}) {
  await admin(this)
  const ledger = await readLedger(input, this)
  if (ledger.state === 'complete') return { errCode: 0, ...summary(ledger) }
  if (ledger.state !== 'readyToDelete' || ledger.cursor !== ledger.operations.length) fail('迁移尚未完成，不能删除账号')
  const source = data(await userCollection.doc(ledger.sourceUid).get())
  const target = data(await userCollection.doc(ledger.targetUid).get())
  const employee = await employeeByNo(ledger.employeeNo)
  const employeeAccount = (employee && (employee.account || employee.employeeNo)) || ledger.employeeNo
  if (!target || (target.role || []).includes('admin') || target.username !== employeeAccount || !employee || employee.uid !== target._id || employee.state !== 'ready') fail('目标账号或员工资料校验失败')
  if ((await scan(ledger.sourceUid)).length || (await quotas(ledger.sourceUid)).length) fail('原账号仍有未迁移归属，不能删除')
  if (source) {
    if (source.username !== ledger.sourceUsername || (source.role || []).includes('admin') || source.status !== 1) fail('原账号状态已变化，禁止删除')
    const result = await userCollection.where({ _id: source._id, username: ledger.sourceUsername, status: 1, role: db.command.neq('admin') }).remove()
    if (removed(result) !== 1) fail('原账号删除结果未确认，请回读后重试')
  }
  await db.collection(MERGES).doc(ledger._id).update({ state: 'complete', completedAt: Date.now(), deletedBy: this.authInfo.uid })
  return { errCode: 0, ...summary({ ...ledger, state: 'complete' }) }
}

module.exports = { previewLegacyAccountMerge, startLegacyAccountMerge, continueLegacyAccountMerge, finalizeLegacyAccountMerge }
