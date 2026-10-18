'use strict'
const { checkAuth, ok, fail, ClientError } = require('mes-common')
const { execute } = require('mes-operations')
exports.main = async event => {
    const db = uniCloud.database()
    const auth = await checkAuth(db, event && event.uniIdToken)
    if (auth.errCode) return fail(auth.errCode, auth.message)
    try { return ok(await execute(db, auth, event || {})) }
    catch (error) { if (error instanceof ClientError) return fail(error.code, error.message); console.error('[production-operations]', error.message); return fail(500, '生产服务暂时不可用，请稍后重试') }
}
