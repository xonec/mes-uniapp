'use strict'

// 云函数：app-version
// 用途：App 端启动时的版本检查。集合 app_versions 单文档（_id 固定 'latest'）保存最新发布信息。
//   action = 'get'  ：返回最新发布信息（公开，无需登录）
//   action = 'set'  ：管理员写入最新发布信息（versionName / versionCode / url / notes / force）
//
// 返回协议 { code, message, data }；依赖公共模块 mes-common。

const { checkAdmin, ok, fail } = require('mes-common')

const COLL = 'app_versions'
const DOC_ID = 'latest'

// 延迟初始化数据库：避免顶层 uniCloud.database() 在支付宝云模块加载阶段崩溃
let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

// set 在部分云厂商不可用时回退 update → add（与 batch-buckets 同策略）
async function upsertDoc(id, data) {
    const coll = db.collection(COLL)
    try {
        await coll.doc(id).set(data)
        return
    } catch (e) { /* 回退 */ }

    let updated = 0
    try {
        const r = await coll.doc(id).update(data)
        updated = (r && (r.updated || r.affectedDocs ||
            (r.result && (r.result.updated || r.result.affectedDocs)))) || 0
    } catch (e) { updated = 0 }
    if (updated) return

    try {
        await coll.add(Object.assign({}, data, { _id: id }))
    } catch (e) {
        const msg = String((e && (e.message || e.errMsg)) || e)
        if (/duplicate|exist|already/i.test(msg)) await coll.doc(id).update(data)
        else throw e
    }
}

function normalizeInfo(e) {
    const versionName = String(e.versionName || '').trim()
    if (!/^\d+(\.\d+){0,3}$/.test(versionName)) throw new Error('versionName 需形如 1.1.0')
    const url = String(e.url || '').trim()
    if (!/^https?:\/\//.test(url)) throw new Error('url 需以 http:// 或 https:// 开头')
    return {
        versionName,
        versionCode: Number(e.versionCode) || 0,
        url,
        notes: String(e.notes || '').slice(0, 500),
        force: !!e.force
    }
}

exports.main = async (event) => {
    event = event || {}
    const action = event.action
    try {
        db = getDb()

        if (action === 'get') {
            // 公开接口：只回最新发布信息，不含任何内部字段
            const res = await db.collection(COLL).doc(DOC_ID).get()
            const row = (res && res.data && res.data[0]) || null
            if (!row) return ok(null)
            return ok({
                versionName: row.versionName,
                versionCode: row.versionCode || 0,
                url: row.url,
                notes: row.notes || '',
                force: !!row.force,
                publishedAt: row.publishedAt || null
            })
        }

        if (action === 'set') {
            const auth = await checkAdmin(db, event.uniIdToken)
            if (auth.errCode) return fail(auth.errCode, auth.message)
            const info = normalizeInfo(event)
            await upsertDoc(DOC_ID, Object.assign({}, info, {
                publishedAt: Date.now(),
                publishedBy: auth.uid
            }))
            return ok(info)
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        console.error('[app-version] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '内部错误: ' + (e && (e.message || e.errMsg) || JSON.stringify(e)))
    }
}
