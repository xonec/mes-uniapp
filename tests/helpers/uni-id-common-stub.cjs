// 测试用 uni-id-common 桩：把 require('uni-id-common') 重定向到这里。
// createInstance() → checkToken(token)：信任形如 "tok-<uid>" 的测试 token，返回 { errCode:0, uid }。
// 真实鉴权逻辑由被测的 mes-common.checkAuth 负责（回查用户表取 status/role）。

module.exports = {
    createInstance() {
        return {
            async checkToken(token) {
                if (!token || typeof token !== 'string') {
                    return { errCode: 'uni-id-check-token-failed', errMsg: 'invalid token' }
                }
                const m = /^tok-(.+)$/.exec(token)
                if (!m) return { errCode: 'uni-id-check-token-failed', errMsg: 'invalid token' }
                // iat 取 60 秒前（秒级），供 mes-common 校验 valid_token_date（改密失效）用
                return { errCode: 0, uid: m[1], role: ['user'], iat: Math.floor(Date.now() / 1000) - 60 }
            }
        }
    }
}
