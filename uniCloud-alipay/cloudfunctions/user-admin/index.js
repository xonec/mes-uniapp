'use strict'

// 云函数：user-admin
// 用途：用户管理的「列表 / 个人资料」薄封装（登录/建号/改密/禁用/注销走官方 uni-id-co 云对象）。
//   action = 'listUsers'：列出全部账号（需 admin）
//   action = 'profile'  ：返回当前登录人的 uid / role / nickname（需登录）
// 依赖公共模块 mes-common（鉴权已委托 uni-id）。

const { checkAuth, checkAdmin, ok, fail } = require('mes-common')

const COLL = 'uni-id-users'

let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

/** 返回当前账号资料或管理员可见的账号列表，分页请求仅返回必要的公开账号字段。 */
exports.main = async (event) => {
    event = event || {}
    const action = event.action
    const db = getDb()
    try {
        if (action === 'profile') {
            const auth = await checkAuth(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const res = await db.collection(COLL).doc(auth.uid).get()
            const u = (res && res.data && res.data[0]) || null
            return ok({
                _id: auth.uid,
                uid: auth.uid,
                username: (u && u.username) || '',
                mobile: (u && u.mobile) || '',
                email: (u && u.email) || '',
                avatar_file: (u && u.avatar_file) || null,
                role: auth.role || [],
                permission: (u && u.permission) || [],
                nickname: (u && (u.nickname || u.username)) || ''
            })
        }

        if (action === 'listUsers') {
            const auth = await checkAdmin(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const paginated = event.page != null
            const page = Math.max(1, Math.floor(Number(event.page) || 1))
            const pageSize = Math.min(100, Math.max(1, Math.floor(Number(event.pageSize) || 100)))
            if (!Number.isSafeInteger(page) || page > 10000) return fail(400, '账号列表页码无效')
            let query = db.collection(COLL)
            if (event.normalOnly === true) query = query.where(db.command.or([{ status: 0 }, { status: db.command.exists(false) }]))
            query = query.field({ _id: true, username: true, nickname: true, role: true, status: true, register_date: true, mobile: true, email: true, tags: true, dcloud_appid: true, last_login_date: true, processIds: true, autoCreated: true })
                .orderBy(paginated ? '_id' : 'register_date', 'asc')
            // 多读取一条判断是否还有下一页，避免正常账号被前面的封禁账号占满额度。
            const res = await (paginated ? query.skip((page - 1) * pageSize).limit(pageSize + 1) : query.limit(200)).get()
            const raw = res.data || []
            // 过滤「已注销(status=4)」；uni-id status：0=正常 1=封禁 2/3=审核 4=注销
            const list = (paginated ? raw.slice(0, pageSize) : raw)
                .filter(u => u.status !== 4)
                .map(u => ({
                    _id: u._id,
                    username: u.username,
                    account: u.username,
                    nickname: u.nickname || u.username,
                    role: u.role || [],
                    status: (typeof u.status === 'number') ? u.status : 0,
                    register_date: u.register_date || null
                }))
            // 按 uid 关联员工档案补工号；集合未部署或读取失败时保持账号列表可用。
            try {
                const uids = list.map(row => row._id).filter(Boolean)
                if (uids.length) {
                    const profiles = (await db.collection('mes_employee_accounts')
                        .where({ uid: db.command.in(uids), state: 'ready' })
                        .field({ uid: true, employeeNo: true, account: true }).limit(200).get()).data || []
                    const byUid = new Map(profiles.map(row => [row.uid, row]))
                    for (const row of list) {
                        const profile = byUid.get(row._id)
                        row.employeeNo = (profile && profile.employeeNo) || ''
                        if (profile && profile.account && !row.account) row.account = profile.account
                    }
                }
            } catch (error) {
                console.warn('[user-admin] 员工档案关联失败，账号列表不含工号：', error && (error.message || error.errMsg))
            }
            return ok(paginated ? { list, page, pageSize, hasMore: raw.length > pageSize } : { list })
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[user-admin] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
