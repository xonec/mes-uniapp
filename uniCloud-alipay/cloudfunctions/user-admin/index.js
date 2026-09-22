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
                uid: auth.uid,
                role: auth.role || [],
                nickname: (u && (u.nickname || u.username)) || ''
            })
        }

        if (action === 'listUsers') {
            const auth = await checkAdmin(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const res = await db.collection(COLL).orderBy('register_date', 'asc').limit(200).get()
            // 过滤「已注销(status=4)」；uni-id status：0=正常 1=封禁 2/3=审核 4=注销
            const list = (res.data || [])
                .filter(u => u.status !== 4)
                .map(u => ({
                    _id: u._id,
                    username: u.username,
                    nickname: u.nickname || u.username,
                    role: u.role || [],
                    status: (typeof u.status === 'number') ? u.status : 0,
                    register_date: u.register_date || null
                }))
            return ok({ list })
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[user-admin] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
