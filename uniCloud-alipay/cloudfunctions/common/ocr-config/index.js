'use strict'
const advanced = require('./advanced-config')
// ocr-config 纯函数模块（云端 CJS 镜像）：与客户端 utils/ocr-config.js 保持逻辑一致
// 导出：DEFAULT_OCR_CONFIG / PROVIDER_PRESETS / maskApiKey / mergeOcrConfig / effectiveConfig / presetToForm

const DEFAULT_OCR_CONFIG = {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-flash',
    textModel: 'deepseek-flash',
    timeout: 35000,
    maxAttempts: 1,
    dailyLimit: 200,
    userDailyLimit: 100,
    dedupMinutes: 10080,
    economyMode: true,
    ocrSpaceApiKey: '',
    ocrSpaceEngine: 2
}

const PROVIDER_PRESETS = {
    deepseek: {
        label: 'DeepSeek 官方 API',
        apiUrl: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-flash',
        textModel: 'deepseek-flash'
    },
    siliconflow: {
        label: '硅基流动 SiliconFlow',
        apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
        textModel: 'deepseek-ai/DeepSeek-V4.1-Flash'
    },
    selfhost: {
        label: '自建 / 兼容 OpenAI 服务',
        apiUrl: '',
        model: '',
        textModel: ''
    }
}

/** 固定星号遮挡密钥，不返回首尾字符或实际长度。 */
function maskApiKey(key) {
    return String(key || '').trim() ? '********' : ''
}

function mergeOcrConfig(existing, incoming) {
    const e = existing && typeof existing === 'object' ? existing : {}
    const i = incoming && typeof incoming === 'object' ? incoming : {}
    const str = function (v) { return (v === undefined || v === null) ? '' : String(v).trim() }
    const out = {}
    const keys = ['apiUrl', 'apiKey', 'model', 'textModel', 'ocrSpaceApiKey']
    for (let n = 0; n < keys.length; n++) {
        out[keys[n]] = str(i[keys[n]]) || str(e[keys[n]])
    }
    const num = function (v) { const n = Number(v); return (Number.isFinite(n) && n > 0) ? n : 0 }
    out.timeout = num(i.timeout) || num(e.timeout) || DEFAULT_OCR_CONFIG.timeout
    out.maxAttempts = num(i.maxAttempts) || num(e.maxAttempts) || DEFAULT_OCR_CONFIG.maxAttempts
    const defNum = function (iv, ev, dflt) {
        const n = Number(iv)
        if (iv !== undefined && iv !== null && Number.isFinite(n) && n >= 0) return n
        const m = Number(ev)
        if (ev !== undefined && ev !== null && Number.isFinite(m) && m >= 0) return m
        return dflt
    }
    out.dailyLimit = defNum(i.dailyLimit, e.dailyLimit, DEFAULT_OCR_CONFIG.dailyLimit)
    out.userDailyLimit = defNum(i.userDailyLimit, e.userDailyLimit, DEFAULT_OCR_CONFIG.userDailyLimit)
    out.dedupMinutes = defNum(i.dedupMinutes, e.dedupMinutes, DEFAULT_OCR_CONFIG.dedupMinutes)
    out.economyMode = typeof i.economyMode === 'boolean' ? i.economyMode : typeof e.economyMode === 'boolean' ? e.economyMode : DEFAULT_OCR_CONFIG.economyMode
    out.ocrSpaceEngine = num(i.ocrSpaceEngine) || num(e.ocrSpaceEngine) || DEFAULT_OCR_CONFIG.ocrSpaceEngine
    return { ...out, ...advanced.mergeAdvancedConfig(e, i, out) }
}

function effectiveConfig(dbCfg, envDefaults) {
    const d = dbCfg && typeof dbCfg === 'object' ? dbCfg : {}
    const env = Object.assign({}, DEFAULT_OCR_CONFIG, envDefaults || {})
    const pick = function (k, def) {
        const v = d[k]
        if (v === undefined || v === null || String(v).trim() === '') return def
        return v
    }
    const economyMode = pick('economyMode', env.economyMode) !== false
    const output = {
        apiUrl: pick('apiUrl', env.apiUrl),
        apiKey: pick('apiKey', env.apiKey),
        model: pick('model', env.model),
        textModel: pick('textModel', env.textModel),
        timeout: Number(pick('timeout', env.timeout)) || env.timeout,
        maxAttempts: economyMode ? 1 : Number(pick('maxAttempts', env.maxAttempts)) || env.maxAttempts,
        dailyLimit: pick('dailyLimit', env.dailyLimit),
        userDailyLimit: pick('userDailyLimit', env.userDailyLimit),
        dedupMinutes: economyMode ? Math.max(10080, Number(pick('dedupMinutes', env.dedupMinutes)) || 0) : pick('dedupMinutes', env.dedupMinutes),
        economyMode,
        ocrSpaceApiKey: pick('ocrSpaceApiKey', env.ocrSpaceApiKey), ocrSpaceEngine: Number(pick('ocrSpaceEngine', env.ocrSpaceEngine)) || 2
    }
    return { ...output, ...advanced.effectiveAdvancedConfig(d, output) }
}

function presetToForm(presetKey) {
    const p = PROVIDER_PRESETS[presetKey]
    if (!p) return { apiUrl: DEFAULT_OCR_CONFIG.apiUrl, model: DEFAULT_OCR_CONFIG.model, textModel: DEFAULT_OCR_CONFIG.textModel }
    return { apiUrl: p.apiUrl, model: p.model, textModel: p.textModel }
}

module.exports = {
    ...advanced,
    DEFAULT_OCR_CONFIG,
    PROVIDER_PRESETS,
    maskApiKey,
    mergeOcrConfig,
    effectiveConfig,
    presetToForm
}
