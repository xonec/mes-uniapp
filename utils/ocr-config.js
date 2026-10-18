// OCR 识别服务配置（多供应商）纯函数模块
// 客户端（设置页）与云端（doc-ocr 云函数）共用同一套逻辑，避免重复实现。
// 设计要点：
//   - 供应商预设（DeepSeek 官方 / 硅基流动 / 自建兼容 OpenAI）
//   - 密钥脱敏（给前端展示，绝不回传明文）
//   - 合并保存（前端没重填的字段不覆盖，尤其是 Key）
//   - 运行时有效配置（DB 配置优先于环境变量默认，空白回落默认）
//   - 配额/去重：dailyLimit / userDailyLimit / dedupMinutes（保护额度，防浪费）

export const DEFAULT_OCR_CONFIG = {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    model: 'deepseek-flash',     // 图片/多模态
    textModel: 'deepseek-flash',            // 文本兜底
    timeout: 60000,                            // 单次调用超时（ms）
    maxAttempts: 2,                            // 包含首次请求的最多尝试次数（1~3）
    dailyLimit: 200,                           // 全局每日识别上限（0=不限）
    userDailyLimit: 100,                       // 每用户每日识别上限（0=不限）
    dedupMinutes: 10080,                       // 默认复用相同输入 7 天
    ocrSpaceApiKey: '',
    ocrSpaceEngine: 2
}

// 供应商预设：切换时只填 apiUrl + 双模型名，Key / 超时 / 重试 / 限额由用户另行填写
export const PROVIDER_PRESETS = {
    deepseek: {
        label: 'DeepSeek 官方 API',
        apiUrl: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-flash',
        textModel: 'deepseek-flash'
    },
    siliconflow: {
        label: '硅基流动 SiliconFlow',
        apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
        model: 'deepseek-ai/DeepSeek-V4.1-Flash',
        textModel: 'deepseek-ai/DeepSeek-V4.1-Flash'
    },
    selfhost: {
        label: '自建 / 兼容 OpenAI 服务',
        apiUrl: '',
        model: '',
        textModel: ''
    }
}

/** 固定星号遮挡密钥，不显示真实字符或实际长度。 */
export function maskApiKey(key) {
    return String(key || '').trim() ? '********' : ''
}

// 合并保存：incoming 中空白字段不覆盖 existing（核心：未重填的 Key 保留原值）
export function mergeOcrConfig(existing, incoming) {
    const e = existing && typeof existing === 'object' ? existing : {}
    const i = incoming && typeof incoming === 'object' ? incoming : {}
    const str = (v) => (v === undefined || v === null ? '' : String(v).trim())
    const out = {}
    for (const k of ['apiUrl', 'apiKey', 'model', 'textModel', 'ocrSpaceApiKey']) {
        out[k] = str(i[k]) || str(e[k])
    }
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
    out.timeout = num(i.timeout) || num(e.timeout) || DEFAULT_OCR_CONFIG.timeout
    out.maxAttempts = num(i.maxAttempts) || num(e.maxAttempts) || DEFAULT_OCR_CONFIG.maxAttempts
    // 限额类字段：显式值（含 0=不限）优先，其次沿用旧值，最后才用内置默认
    const defNum = (iv, ev, dflt) => {
        const n = Number(iv)
        if (iv !== undefined && iv !== null && Number.isFinite(n) && n >= 0) return n
        const m = Number(ev)
        if (ev !== undefined && ev !== null && Number.isFinite(m) && m >= 0) return m
        return dflt
    }
    out.dailyLimit = defNum(i.dailyLimit, e.dailyLimit, DEFAULT_OCR_CONFIG.dailyLimit)
    out.userDailyLimit = defNum(i.userDailyLimit, e.userDailyLimit, DEFAULT_OCR_CONFIG.userDailyLimit)
    out.dedupMinutes = defNum(i.dedupMinutes, e.dedupMinutes, DEFAULT_OCR_CONFIG.dedupMinutes)
    out.ocrSpaceEngine = num(i.ocrSpaceEngine) || num(e.ocrSpaceEngine) || DEFAULT_OCR_CONFIG.ocrSpaceEngine
    return out
}

// 运行时有效配置：DB 配置优先于环境变量默认；DB 中空白字段回落到默认
// envDefaults 由云端从 process.env 解析得到；客户端可传 {} 仅看 DB 值（通常直接取 DB）
export function effectiveConfig(dbCfg, envDefaults) {
    const d = dbCfg && typeof dbCfg === 'object' ? dbCfg : {}
    const env = Object.assign({}, DEFAULT_OCR_CONFIG, envDefaults || {})
    const pick = (k, def) => {
        const v = d[k]
        if (v === undefined || v === null || String(v).trim() === '') return def
        return v
    }
    return {
        apiUrl: pick('apiUrl', env.apiUrl),
        apiKey: pick('apiKey', env.apiKey),
        model: pick('model', env.model),
        textModel: pick('textModel', env.textModel),
        timeout: Number(pick('timeout', env.timeout)) || env.timeout,
        maxAttempts: Number(pick('maxAttempts', env.maxAttempts)) || env.maxAttempts,
        dailyLimit: pick('dailyLimit', env.dailyLimit),
        userDailyLimit: pick('userDailyLimit', env.userDailyLimit),
        dedupMinutes: pick('dedupMinutes', env.dedupMinutes),
        ocrSpaceApiKey: pick('ocrSpaceApiKey', env.ocrSpaceApiKey), ocrSpaceEngine: Number(pick('ocrSpaceEngine', env.ocrSpaceEngine)) || 2
    }
}

// 前端表单默认值（新建/未配置时）：从预设或默认中取
export function presetToForm(presetKey) {
    const p = PROVIDER_PRESETS[presetKey]
    if (!p) return { apiUrl: DEFAULT_OCR_CONFIG.apiUrl, model: DEFAULT_OCR_CONFIG.model, textModel: DEFAULT_OCR_CONFIG.textModel }
    return { apiUrl: p.apiUrl, model: p.model, textModel: p.textModel }
}
