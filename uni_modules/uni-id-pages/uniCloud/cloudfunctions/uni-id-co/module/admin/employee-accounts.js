const { db, userCollection } = require('../../common/constants')
const { checkIdCard } = require('../../common/utils')
const addUser = require('./add-user')
const updateUser = require('./update-user')

const COLLECTION = 'mes_employee_accounts'
const BACKUPS = 'mes_employee_account_backups'
const EMPLOYEE_APP_IDS = ['__UNI__A2E52B9']
const MAX_LIST = 100
const BACKUP_PREFIX = 'backup:'

function reject(message) {
  throw { errCode: 'EMPLOYEE_ACCOUNT_ERROR', errMsg: message }
}

async function requireAdmin(context) {
  await context.middleware.auth()
  if (!(context.authInfo.role || []).includes('admin')) reject('仅管理员可管理员工账号资料')
}

/** 稳定档案 id：有账号用 emp:<uid>，没有账号时用 emp:<工号>；工号以后可改，但 id 不再变。 */
function docId(uid, employeeNo) {
  return 'emp:' + (uid || employeeNo)
}

const EMPLOYEE_NO_PATTERN = /^\d{6,20}$/
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/

function validEmployeeNo(employeeNo) {
  if (!EMPLOYEE_NO_PATTERN.test(employeeNo)) reject('工号须为6～20位数字，请按文本读取')
  return employeeNo
}

function validAccount(account) {
  if (!ACCOUNT_PATTERN.test(account)) reject('登录账号须为3～32位字母、数字、点、下划线或短横线')
  return account
}

/** 身份证校验与建号共用同一口径（格式、校验位、出生日期）。 */
function validIdCard(idCard) {
  if (!/^\d{17}[\dX]$/.test(idCard) || !checkIdCard(idCard)) reject('身份证格式或校验位不正确')
  const birthday = idCard.slice(6, 10) + '-' + idCard.slice(10, 12) + '-' + idCard.slice(12, 14)
  const parsed = new Date(birthday + 'T00:00:00Z')
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthday) reject('身份证出生日期不正确')
  return idCard
}

/** 工号与登录账号拆开校验：工号 6～20 位数字；账号缺省等于工号。 */
function normalize(input) {
  const employeeNo = validEmployeeNo(typeof input.employeeNo === 'string' ? input.employeeNo.trim() : '')
  const accountExplicit = typeof input.account === 'string' && !!input.account.trim()
  const account = validAccount(accountExplicit ? input.account.trim() : employeeNo)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 60) reject('请核对姓名，长度须为1～60个字符')
  const idCard = validIdCard(typeof input.idCard === 'string' ? input.idCard.trim().toUpperCase() : '')
  return { employeeNo, account, accountExplicit, name, idCard }
}

const data = result => (result && result.data || [])[0] || null

/** 按账号查 uni-id 用户，账号唯一性由 uni-id-users.username 唯一索引兜底。 */
async function userByAccount(account) {
  const users = (await userCollection.where({ username: account })
    .field({ _id: true, username: true, nickname: true, status: true }).limit(2).get()).data || []
  return users
}

/** 账号字段用登录账号；历史档案没有 account 字段时回读 username。 */
async function accountOf(profile) {
  if (profile.account) return profile.account
  if (!profile.uid) return profile.employeeNo || ''
  const user = data(await userCollection.doc(profile.uid).field({ username: true }).get())
  return (user && user.username) || profile.employeeNo || ''
}

async function withAccounts(rows) {
  const uids = rows.map(row => row.uid).filter(Boolean)
  const users = new Map()
  if (uids.length) {
    const found = (await userCollection.where({ _id: db.command.in(uids) }).field({ _id: true, username: true }).limit(200).get()).data || []
    for (const user of found) users.set(user._id, user)
  }
  return rows.map(row => ({ ...row, account: (users.get(row.uid) || {}).username || row.account || row.employeeNo || '' }))
}

/** 预检工号、身份证、账号三类占用，不写库。 */
async function inspect(record) {
  const profiles = db.collection(COLLECTION)
  const sameNo = (await profiles.where({ employeeNo: record.employeeNo }).limit(2).get()).data || []
  if (sameNo.length > 1) return { state: 'conflict', message: '工号存在多条员工资料，请管理员核对' }
  const duplicateIdCard = (await profiles.where({ idCard: record.idCard }).limit(2).get()).data || []
  if (duplicateIdCard.some(item => item.employeeNo !== record.employeeNo)) return { state: 'conflict', message: '身份证已关联其他工号，请人工核对' }
  const users = await userByAccount(record.account)
  const profile = sameNo[0] || null
  if (profile) {
    if (profile.name !== record.name || profile.idCard !== record.idCard) return { state: 'conflict', message: '工号已有不同的姓名或身份证，请人工核对' }
    if (profile.state !== 'ready') return { state: 'conflict', message: '该工号有未完成的建号记录，请管理员核对；不会重复建号' }
    const linked = profile.uid ? data(await userCollection.doc(profile.uid).field({ _id: true, username: true, nickname: true, status: true }).get()) : null
    const account = (linked && linked.username) || profile.account || ''
    if (users.some(user => user._id !== profile.uid)) return { state: 'conflict', message: '登录账号已被其他人员使用，请更换账号后再试' }
    // 只有显式传入不同账号才算冲突；批量导入默认 account=工号 时以已绑定账号为准。
    if (record.accountExplicit && record.account && account && record.account !== account) return { state: 'conflict', message: '该工号已绑定账号 ' + account + '；要修改账号请在账号管理里操作' }
    if (!linked || linked.nickname !== record.name || (linked.status != null && linked.status !== 0)) return { state: 'conflict', message: '已有账号资料或状态与员工资料不一致，请人工核对' }
    return { state: 'existing', message: '账号及资料已存在，保留原密码', uid: profile.uid, account }
  }
  if (users.length) {
    const bound = (await profiles.where({ uid: users[0]._id }).limit(2).get()).data || []
    return { state: 'conflict', message: bound.length ? '该登录账号已绑定其他员工资料，请更换账号' : '登录账号已存在但未关联员工资料，请人工核对' }
  }
  return { state: 'ready', message: '可创建普通账号' }
}

/** 管理员逐条预检，返回分类结果，不建立账号或员工资料。 */
async function previewEmployeeAccount(input = {}) {
  await requireAdmin(this)
  const record = normalize(input)
  this.middleware.validate({ username: record.account, password: record.account, nickname: record.name }, { username: 'username', password: 'password', nickname: 'nickname' })
  const checked = await inspect(record)
  return { errCode: 0, ...checked, employeeNo: record.employeeNo, account: checked.account || record.account }
}

/** 先建登录账号，再写稳定 id 的人员档案；重复请求只回读，绝不重置已有密码。 */
async function createEmployeeAccount(input = {}) {
  await requireAdmin(this)
  const record = normalize(input)
  this.middleware.validate({ username: record.account, password: record.account, nickname: record.name }, { username: 'username', password: 'password', nickname: 'nickname' })
  const checked = await inspect(record)
  if (checked.state !== 'ready') return { errCode: 0, ...checked, employeeNo: record.employeeNo, account: checked.account || record.account }
  let created = null
  try {
    created = await addUser.call(this, {
      username: record.account, password: record.account, nickname: record.name,
      role: [], authorizedApp: EMPLOYEE_APP_IDS, status: 0
    })
  } catch (_) {
    return await conflictAfterCreate(record, '建号失败；账号可能已被占用，请重新核对')
  }
  if (!created || !created.uid) return await conflictAfterCreate(record, '建号结果缺少UID，请管理员核对')
  const now = Date.now()
  const document = {
    _id: docId(created.uid, record.employeeNo),
    employeeNo: record.employeeNo,
    account: record.account,
    name: record.name,
    idCard: record.idCard,
    uid: created.uid,
    state: 'ready',
    createdAt: now,
    createdBy: this.authInfo.uid,
    updatedAt: now
  }
  try {
    await db.collection(COLLECTION).add(document)
  } catch (_) {
    // 工号/身份证唯一索引兜底：撤销刚建的账号，避免出现有账号没有档案的半成品。
    try { await userCollection.doc(created.uid).remove() } catch (ignored) { /* 留给人工核对 */ }
    return await conflictAfterCreate(record, '员工资料写入失败（工号或身份证可能已被占用），请重新核对')
  }
  return { errCode: 0, state: 'created', message: '已创建；登录账号为 ' + record.account + '，初始密码同账号', uid: created.uid, employeeNo: record.employeeNo, account: record.account }
}

/** 写入失败后回读最新状态，避免直接报错掩盖“其实已被并发创建”的情况。 */
async function conflictAfterCreate(record, message) {
  const latest = await inspect(record)
  if (latest.state === 'existing') return { errCode: 0, ...latest, employeeNo: record.employeeNo, account: latest.account || record.account }
  return { errCode: 0, state: 'conflict', message: message, employeeNo: record.employeeNo, account: record.account }
}

/**
 * 管理员修改员工档案：工号只改档案，账号会同步改 uni-id 登录名（密码不变，旧 token 继续有效）。
 * 用 uid 定位时 employeeNo 视为“新工号”；不传 uid 时 employeeNo 只用于定位。
 */
async function updateEmployeeAccount(input = {}) {
  await requireAdmin(this)
  const uid = typeof input.uid === 'string' ? input.uid.trim() : ''
  const locatorNo = typeof input.employeeNo === 'string' ? input.employeeNo.trim() : ''
  if (!uid && !locatorNo) reject('请提供 uid 或工号定位员工档案')
  const profiles = db.collection(COLLECTION)
  const located = await profiles.where(uid ? { uid } : { employeeNo: locatorNo }).limit(2).get()
  const rows = located.data || []
  if (!rows.length) reject('员工档案不存在')
  if (rows.length > 1) reject('定位到多条员工档案，请人工核对')
  const profile = rows[0]
  const targetUid = profile.uid || ''
  const user = targetUid ? data(await userCollection.doc(targetUid).field({ _id: true, username: true, nickname: true, role: true, status: true }).get()) : null
  if (targetUid && !user) reject('员工档案关联的登录账号不存在，请人工核对')
  if (user && (user.role || []).includes('admin')) reject('不能修改管理员账号')

  const patch = {}
  const changed = []
  // 改工号：仅改档案字段；用 uid 定位时 employeeNo 才是新值。
  if (uid && locatorNo && locatorNo !== String(profile.employeeNo || '')) {
    validEmployeeNo(locatorNo)
    const sameNo = (await profiles.where({ employeeNo: locatorNo }).limit(2).get()).data || []
    if (sameNo.some(row => row._id !== profile._id)) reject('工号已被其他员工使用')
    patch.employeeNo = locatorNo
    changed.push('employeeNo')
  }
  const nextName = typeof input.name === 'string' ? input.name.trim() : ''
  if (typeof input.name === 'string' && nextName !== String(profile.name || '')) {
    if (!nextName || nextName.length > 60) reject('请核对姓名，长度须为1～60个字符')
    patch.name = nextName
    changed.push('name')
  }
  const nextIdCard = typeof input.idCard === 'string' ? input.idCard.trim().toUpperCase() : ''
  if (typeof input.idCard === 'string' && nextIdCard !== String(profile.idCard || '').toUpperCase()) {
    validIdCard(nextIdCard)
    const sameIdCard = (await profiles.where({ idCard: nextIdCard }).limit(2).get()).data || []
    if (sameIdCard.some(row => row._id !== profile._id)) reject('身份证已关联其他员工')
    patch.idCard = nextIdCard
    changed.push('idCard')
  }
  const accountExplicit = typeof input.account === 'string' && !!input.account.trim()
  const nextAccount = accountExplicit ? input.account.trim() : ''
  if (accountExplicit) {
    validAccount(nextAccount)
    if (!targetUid || !user) reject('该员工档案还没有登录账号，不能修改登录账号')
    if (nextAccount !== user.username) {
      const used = (await userCollection.where({ username: nextAccount }).field({ _id: true, role: true }).limit(2).get()).data || []
      if (used.some(row => row._id !== targetUid)) {
        if (used.some(row => (row.role || []).includes('admin'))) reject('不能把登录账号改成管理员账号')
        reject('登录账号已被其他账号使用')
      }
      patch.account = nextAccount
      changed.push('account')
    }
  }
  if (!changed.length) return { errCode: 0, employee: employeeView(profile), changed: [] }

  // 先改登录名（uni-id 官方 updateUser，密码不传即不变；旧 token 继续有效），失败直接回错。
  if (changed.includes('account')) {
    const previousAccount = user.username
    try {
      await updateUser.call(this, { uid: targetUid, username: nextAccount })
    } catch (error) {
      const code = String(error && (error.errCode || error.message) || '')
      reject(/exist|already|已存在|重复/i.test(code) ? '登录账号已被其他账号使用' : '修改登录账号失败，请稍后重试')
    }
    try {
      await profiles.doc(profile._id).update({ ...patch, updatedAt: Date.now() })
    } catch (_) {
      // 档案写入失败要回滚登录名，避免账号和档案不一致。
      try { await updateUser.call(this, { uid: targetUid, username: previousAccount }) }
      catch (rollbackError) { console.error('[employee-account] 登录名回滚失败', rollbackError && (rollbackError.errCode || rollbackError.message)) }
      reject('员工档案更新失败，已尝试恢复原登录账号；请核对后再试')
    }
  } else {
    await profiles.doc(profile._id).update({ ...patch, updatedAt: Date.now() })
  }
  const fresh = { ...profile, ...patch }
  // 历史档案可能没有 account 字段，展示时回落到登录账号。
  if (!fresh.account && user) fresh.account = user.username
  return { errCode: 0, employee: employeeView(fresh), changed }
}

/** 返回给管理端的员工档案视图（含 account；不返回身份证明文）。 */
function employeeView(profile) {
  return {
    _id: profile._id,
    employeeNo: profile.employeeNo || '',
    account: profile.account || '',
    name: profile.name || '',
    uid: profile.uid || ''
  }
}

/** 后台按账号列表回查员工资料：身份证只走管理员接口。 */
async function getEmployeeAccounts(input = {}) {
  await requireAdmin(this)
  if (!Array.isArray(input.uids) || input.uids.length > 200 || input.uids.some(uid => typeof uid !== 'string' || !uid || uid.length > 128)) reject('账号查询参数不正确')
  const uids = [...new Set(input.uids)]
  if (!uids.length) return { errCode: 0, rows: [] }
  const rows = (await db.collection(COLLECTION).where({ uid: db.command.in(uids), state: 'ready' })
    .field({ uid: true, employeeNo: true, account: true, name: true, idCard: true }).limit(200).get()).data || []
  return { errCode: 0, rows: await withAccounts(rows) }
}

/** 员工资料列表（管理员）：按工号/姓名/账号筛选，返回登录账号用于后台双列展示。 */
async function listEmployeeAccounts(input = {}) {
  await requireAdmin(this)
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const pageSize = Math.min(MAX_LIST, Math.max(1, Math.floor(Number(input.pageSize) || 20)))
  if (page > 10000) reject('页码无效')
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim().slice(0, 40) : ''
  const profiles = db.collection(COLLECTION)
  const filters = []
  if (input.state) filters.push({ state: String(input.state).slice(0, 20) })
  if (keyword) {
    const regexp = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filters.push(db.command.or([
      { employeeNo: db.RegExp({ regexp, options: 'i' }) },
      { name: db.RegExp({ regexp, options: 'i' }) },
      { account: db.RegExp({ regexp, options: 'i' }) }
    ]))
  }
  let query = profiles
  if (filters.length) query = query.where(db.command.and(filters))
  const counted = await query.count()
  const rows = (await query.orderBy('employeeNo', 'asc').skip((page - 1) * pageSize).limit(pageSize).get()).data || []
  return { errCode: 0, rows: await withAccounts(rows), total: counted.total || 0, page, pageSize }
}

/** 分页读完整个集合，迁移动作要用完整清单。 */
async function readAll(collectionName) {
  const rows = []
  for (let offset = 0; ; offset += 100) {
    const page = (await db.collection(collectionName).orderBy('_id', 'asc').skip(offset).limit(100).get()).data || []
    rows.push(...page)
    if (page.length < 100) return rows
  }
}

/**
 * 一次性迁移：把 `_id=工号` 的旧档案迁成稳定 id（emp:<uid> / emp:<employeeNo>）。
 * 先写备份，再删旧档、写新档；已迁移的跳过，中断后重跑会按备份恢复，可重复执行。
 */
async function migrateEmployeeAccountIds(input = {}) {
  await requireAdmin(this)
  const dryRun = input.dryRun === true
  const profiles = db.collection(COLLECTION)
  const backups = db.collection(BACKUPS)
  const all = await readAll(COLLECTION)
  const legacy = all.filter(row => !String(row._id || '').startsWith('emp:'))
  const existingIds = new Set(all.map(row => row._id))
  const result = { errCode: 0, dryRun, total: all.length, migrated: 0, already: all.length - legacy.length, recovered: 0, skipped: 0, failed: [], plan: [] }

  // 中断恢复：有备份、没有旧档、也没有新档时，从备份重建新档。
  const backupRows = await readAll(BACKUPS).catch(() => [])
  for (const backup of backupRows) {
    const snapshot = backup.snapshot || null
    if (!snapshot || !backup.oldId || !backup.newId) continue
    if (existingIds.has(backup.oldId)) continue
    if (existingIds.has(backup.newId)) continue
    const recovery = { oldId: backup.oldId, newId: backup.newId, employeeNo: backup.employeeNo || '', uid: backup.uid || '', targetExists: false, action: 'recover' }
    result.plan.push(recovery)
    if (dryRun) continue
    try {
      await profiles.doc(backup.newId).set({ ...snapshot, _id: backup.newId })
      existingIds.add(backup.newId)
      result.recovered++
    } catch (error) {
      result.failed.push({ id: backup.oldId, message: String((error && (error.errMsg || error.message)) || error).slice(0, 160) })
    }
  }

  for (const row of legacy) {
    const oldId = row._id
    const employeeNo = String(row.employeeNo || (/^\d{6,20}$/.test(oldId) ? oldId : '')).trim()
    if (!employeeNo) {
      result.skipped++
      result.plan.push({ oldId, newId: '', employeeNo: '', uid: String(row.uid || ''), targetExists: false, action: 'skip', reason: '缺少工号，无法迁移' })
      result.failed.push({ id: oldId, message: '缺少工号，无法迁移' })
      continue
    }
    const uid = String(row.uid || '').trim()
    const newId = docId(uid, employeeNo)
    if (existingIds.has(newId)) {
      result.plan.push({ oldId, newId, employeeNo, uid, targetExists: true, action: 'delete-old' })
      if (!dryRun) { try { await profiles.doc(oldId).remove(); existingIds.delete(oldId) } catch (error) { result.failed.push({ id: oldId, message: String(error && (error.errMsg || error.message) || error).slice(0, 160) }) } }
      result.migrated++
      continue
    }
    const account = row.account || await accountOf({ ...row, employeeNo })
    const snapshot = { ...row, employeeNo, account, _id: newId }
    delete snapshot._id
    result.plan.push({ oldId, newId, employeeNo, uid, targetExists: false, action: 'move' })
    if (dryRun) { result.migrated++; continue }
    try {
      await backups.doc(BACKUP_PREFIX + oldId).set({ oldId, newId, employeeNo, uid, snapshot: { ...row, employeeNo, account }, at: Date.now(), by: this.authInfo.uid })
      await profiles.doc(oldId).remove()
      existingIds.delete(oldId)
      await profiles.doc(newId).set({ ...snapshot, _id: newId })
      existingIds.add(newId)
      result.migrated++
    } catch (error) {
      result.failed.push({ id: oldId, message: String((error && (error.errMsg || error.message)) || error).slice(0, 160) })
    }
  }
  result.planned = result.plan.filter(item => ['move', 'delete-old', 'recover'].includes(item.action)).length
  return result
}

module.exports = {
  previewEmployeeAccount,
  createEmployeeAccount,
  updateEmployeeAccount,
  getEmployeeAccounts,
  listEmployeeAccounts,
  migrateEmployeeAccountIds,
  __rules: { docId, normalize }
}
