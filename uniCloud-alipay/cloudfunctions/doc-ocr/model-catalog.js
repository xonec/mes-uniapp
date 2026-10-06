'use strict'
const { ClientError } = require('mes-common')
const { PROVIDERS, normalizeProviders } = require('ocr-config')
const catalogCache = new Map()

/** 只显示分类信息，避免供应商异常响应泄露密钥或内部请求内容。 */
function catalogFailure(status, error, stage) {
    if (status === 401) return { reason: 'unauthorized', message: '供应商返回 401：Key 无效或已失效，请填写该供应商的有效 API Key。' }
    if (status === 403) return { reason: 'forbidden', message: '供应商返回 403：当前 Key 没有模型列表访问权限，请检查账号权限。' }
    if (status === 404) return { reason: 'not-found', message: '供应商返回 404：模型列表地址不存在，请检查 API 地址。' }
    if (status === 429) return { reason: 'rate-limit', message: '供应商返回 429：请求过于频繁，请稍后刷新。' }
    if (status >= 500) return { reason: 'upstream-unavailable', message: '供应商服务暂时不可用（HTTP ' + status + '），请稍后刷新。' }
    if (status >= 400) return { reason: 'upstream-http', message: '供应商拒绝模型列表请求（HTTP ' + status + '），请核对账号和配置。' }
    const code = String(error && (error.errCode || error.code || error.name) || '')
    const detail = code + ' ' + String(error && (error.errMsg || error.message) || '')
    if (/timeout|timedout|ETIMEDOUT/i.test(detail)) return { reason: 'timeout', message: '云端读取模型列表超时，请稍后刷新。' }
    if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(detail)) return { reason: 'dns', message: '云端无法解析供应商域名，请核对 API 地址或稍后刷新。' }
    if (/CERT|TLS|SSL/i.test(detail)) return { reason: 'tls', message: '供应商 HTTPS 连接失败，请检查服务证书。' }
    if (/ECONN|socket|network/i.test(detail)) return { reason: 'network', message: '云端无法连接供应商，请稍后刷新。' }
    if (stage === 'response') return { reason: 'response-format', message: '供应商返回的内容不是有效模型列表' + (status ? '（HTTP ' + status + '）' : '') + '。' }
    const safeCode = /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : 'unknown'
    return { reason: 'request-failed', message: '云端读取模型列表失败（' + safeCode + '），请稍后刷新。' }
}

function modelsUrl(provider) {
    if (provider.type === 'deepseek') return 'https://api.deepseek.com/models'
    if (provider.type === 'siliconflow') return 'https://api.siliconflow.cn/v1/models?sub_type=chat'
    return provider.apiUrl.replace(/\/chat\/completions\/?$/, '/models')
}

/** 只在管理员请求时读取供应商模型列表；响应不包含密钥，失败时保留预置列表。 */
async function getModels(config, requested, forceRefresh = false) {
    const provider = requested && typeof requested === 'object'
        ? normalizeProviders([requested], config.providers)[0]
        : config.providers.find(item => item.id === requested)
    if (!provider) throw new ClientError('请先选择供应商', 400)
    if (provider.type === 'ocrspace') return { models: [1, 2, 3].map(id => ({ id: String(id), name: 'OCR 引擎 ' + id, vision: true })), source: 'builtin' }
    const builtins = PROVIDERS[provider.type].models
    if (!provider.apiKey) return { models: builtins, source: 'builtin', message: '尚未填写 Key，当前显示预置模型；填写后可刷新模型列表。' }
    const { createHash } = require('crypto')
    const key = provider.apiUrl + ':' + createHash('sha256').update(provider.apiKey).digest('hex')
    const cached = catalogCache.get(key)
    if (!forceRefresh && cached && Date.now() - cached.at < 600000) return { models: cached.models, source: 'api' }
    let httpStatus = 0, stage = 'request'
    try {
        const response = await uniCloud.httpclient.request(modelsUrl(provider), {
            method: 'GET', timeout: 12000, followRedirect: false,
            headers: { Authorization: 'Bearer ' + provider.apiKey }
        })
        const status = Number(response && (response.status || response.statusCode))
        httpStatus = Number.isFinite(status) ? status : 0
        stage = 'response'
        // 先读取状态，再解析 JSON。部分供应商的 401 / 403 是纯文本，自动解析会丢失认证失败原因。
        if (status >= 400) throw new Error('Upstream HTTP error')
        const body = response && response.data
        const payload = Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8')) : typeof body === 'string' ? JSON.parse(body) : body
        const rows = payload && payload.data
        if (!Array.isArray(rows)) throw new Error('Invalid model list')
        const models = rows.slice(0, 300).filter(row => row && typeof row.id === 'string' && row.id.length <= 180).map(row => {
            const known = builtins.find(model => model.id === row.id)
            const modalities = row.input_modalities || row.inputModalities
            const vision = Array.isArray(modalities) ? modalities.includes('image') : known && known.vision !== null ? known.vision : /(?:^|[\/_-])(?:VL|vision)(?:[\/_-]|$)/i.test(row.id) ? true : null
            return { id: row.id, name: String(row.name || row.id).slice(0, 180), vision }
        })
        if (!models.length) throw new Error('Empty model list')
        if (catalogCache.size > 30) catalogCache.clear()
        catalogCache.set(key, { models, at: Date.now() })
        return { models, source: 'api' }
    } catch (error) {
        const failure = catalogFailure(httpStatus, error, stage)
        console.warn('[doc-ocr] 模型列表失败 type=' + provider.type + ' reason=' + failure.reason + ' http=' + httpStatus)
        return { models: builtins, source: 'builtin', reason: failure.reason, httpStatus, message: failure.message + '当前显示预置模型，尚未取得账号模型列表。' }
    }
}
module.exports = { getModels }
