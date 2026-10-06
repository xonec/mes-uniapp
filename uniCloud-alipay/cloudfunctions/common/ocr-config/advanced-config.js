'use strict'

const { CONTENT_RECOGNITION_PROMPT, BOM_PROMPT, ORDER_PROMPT } = require('./prompt-defaults')
const PROVIDERS = {
    ocrspace: { label: 'OCR.space', apiUrl: 'https://api.ocr.space/parse/image', models: [] },
    deepseek: { label: 'DeepSeek', apiUrl: 'https://api.deepseek.com/chat/completions', models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash · 视觉 / 文本', vision: true }, { id: 'deepseek-v4-pro', name: 'DeepSeek Pro · 文本', vision: false }] },
    siliconflow: { label: '硅基流动', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', models: [{ id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen2.5 VL 72B · 视觉', vision: true }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash', vision: null }] },
    custom: { label: '自定义兼容服务', apiUrl: '', models: [] }
}
const PROMPT_DEFAULTS = { contentPrompt: CONTENT_RECOGNITION_PROMPT, bomPrompt: BOM_PROMPT, orderPrompt: ORDER_PROMPT }
const text = value => String(value == null ? '' : value).trim()

/** 显示用的星号或密码圆点不能覆盖真实密钥。 */
function validateApiKey(value) {
    const key = text(value)
    if (/^[*＊•●]+$/.test(key)) invalid('星号不是有效的 API Key，请重新输入该供应商 Key')
    if (key.length > 4096) invalid('供应商 Key 不能超过 4096 字符')
    return key
}

function invalid(message) {
    const error = new Error(message)
    error.name = 'OcrConfigError'; error.code = 400
    throw error
}

function providerType(apiUrl) {
    return Object.keys(PROVIDERS).find(type => type !== 'ocrspace' && PROVIDERS[type].apiUrl === apiUrl) || 'custom'
}

function migrate(legacy) {
    legacy = { apiUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', textModel: 'deepseek-flash', ...legacy }
    const selected = providerType(legacy.apiUrl)
    const providers = ['ocrspace', 'deepseek', 'siliconflow'].map(type => ({
        id: type, type, name: PROVIDERS[type].label, apiUrl: PROVIDERS[type].apiUrl, enabled: true,
        apiKey: type === 'ocrspace' ? text(legacy.ocrSpaceApiKey) : type === selected ? text(legacy.apiKey) : ''
    }))
    if (selected === 'custom') providers.push({ id: 'legacy-custom', type: 'custom', name: '原有识别服务', apiUrl: legacy.apiUrl, enabled: true, apiKey: text(legacy.apiKey) })
    return { providers, modelChain: [{ id: 'primary', providerId: selected === 'custom' ? 'legacy-custom' : selected, model: text(legacy.model), textModel: text(legacy.textModel), enabled: true }], screenEngines: [Number(legacy.ocrSpaceEngine) || 2], maxModelCalls: Number(legacy.maxAttempts) || 1 }
}

/** 按稳定供应商 ID 合并密钥；切换供应商或端点时要求重新填写，防止串用密钥。 */
function normalizeProviders(incoming, previous) {
    if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 8) invalid('供应商数量须为 1～8 个')
    const seen = new Set()
    return incoming.map(item => {
        if (!item || typeof item !== 'object') invalid('供应商配置非法')
        if (item.enabled !== undefined && typeof item.enabled !== 'boolean') invalid('供应商启用状态非法')
        const id = text(item.id), type = text(item.type)
        if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id) || seen.has(id) || !PROVIDERS[type]) invalid('供应商标识重复或类型非法')
        seen.add(id)
        const old = (previous || []).find(provider => provider.id === id)
        const apiUrl = type === 'custom' ? text(item.apiUrl) : PROVIDERS[type].apiUrl
        let url
        try { url = new URL(apiUrl) } catch (error) { invalid('请填写完整的识别 API 地址') }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || !/\/chat\/completions\/?$/.test(url.pathname) && type !== 'ocrspace') invalid('API 地址须为完整的 Chat Completions 地址，不含账号、查询参数或片段')
        if (url.protocol !== 'https:' && (!old || old.apiUrl !== apiUrl)) invalid('新增识别服务须使用 HTTPS 地址')
        const same = old && old.type === type && old.apiUrl === apiUrl
        const apiKey = validateApiKey(item.apiKey)
        if (old && old.apiKey && !same && !apiKey) invalid('供应商或 API 地址已变化，请重新填写该供应商 Key')
        return { id, type, name: text(item.name).slice(0, 60) || PROVIDERS[type].label, apiUrl, enabled: item.enabled !== false, apiKey: item.clearKey === true ? '' : apiKey || (same ? text(old.apiKey) : '') }
    })
}

function normalizeChain(chain, providers, strictImage) {
    if (!Array.isArray(chain) || chain.length > 6) invalid('模型顺序最多配置 6 项')
    const ids = new Set()
    return chain.map(step => {
        if (!step || typeof step !== 'object') invalid('模型顺序配置非法')
        if (step.enabled !== undefined && typeof step.enabled !== 'boolean') invalid('模型步骤启用状态非法')
        const id = text(step.id), providerId = text(step.providerId)
        const provider = providers.find(item => item.id === providerId)
        if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id) || ids.has(id) || !provider || provider.type === 'ocrspace') invalid('模型步骤标识重复或供应商不存在')
        ids.add(id)
        const model = text(step.model), textModel = text(step.textModel) || model
        if (!model || model.length > 180 || !textModel || textModel.length > 180) invalid('请选择图片模型和文本模型')
        if (strictImage && provider.type === 'deepseek' && model === 'deepseek-v4-pro') invalid('DeepSeek Pro 仅支持文本，请为图片识别选择 Flash')
        return { id, providerId, model, textModel, enabled: step.enabled !== false }
    })
}

/** 将旧的单供应商配置迁移为顺序模型配置；旧版 App 保存时仍可更新主模型而保留模板。 */
function mergeAdvancedConfig(existing, incoming, legacy) {
    validateApiKey(incoming.apiKey)
    validateApiKey(incoming.ocrSpaceApiKey)
    const base = Array.isArray(existing.providers) ? existing : migrate(existing)
    let providers = normalizeProviders(incoming.providers === undefined ? base.providers : incoming.providers, base.providers)
    let chain = incoming.modelChain === undefined ? base.modelChain : incoming.modelChain
    if (incoming.providers === undefined && incoming.modelChain === undefined && ['apiUrl', 'model', 'textModel', 'apiKey'].some(key => incoming[key] !== undefined && text(incoming[key]) && text(incoming[key]) !== text(existing[key]))) {
        const primary = (base.modelChain || []).find(step => step.enabled && providers.some(provider => provider.id === step.providerId && provider.enabled))
        const primaryProvider = primary && providers.find(provider => provider.id === primary.providerId)
        const type = primaryProvider && primaryProvider.apiUrl === legacy.apiUrl ? primaryProvider.type : providerType(legacy.apiUrl)
        const id = primaryProvider && primaryProvider.apiUrl === legacy.apiUrl ? primaryProvider.id : type === 'custom' ? 'legacy-custom' : type
        const old = providers.find(provider => provider.id === id)
        const updated = normalizeProviders([{ id, type, name: old && old.name || PROVIDERS[type].label, apiUrl: legacy.apiUrl, apiKey: text(incoming.apiKey), enabled: true }], old ? [old] : [])
        providers = providers.filter(provider => provider.id !== id).concat(updated)
        chain = [{ id: primary ? primary.id : 'primary', providerId: id, model: legacy.model, textModel: legacy.textModel, enabled: true }, ...(base.modelChain || []).filter(step => !primary || step.id !== primary.id)]
    }
    if (incoming.providers === undefined && text(incoming.ocrSpaceApiKey)) providers = providers.map(provider => provider.type === 'ocrspace' ? { ...provider, apiKey: text(incoming.ocrSpaceApiKey) } : provider)
    const modelChain = normalizeChain(chain || [], providers, incoming.modelChain !== undefined)
    const screenEngines = incoming.screenEngines === undefined ? incoming.ocrSpaceEngine !== undefined && Number(incoming.ocrSpaceEngine) !== Number((base.screenEngines || [2])[0]) ? [Number(incoming.ocrSpaceEngine)] : base.screenEngines || [2] : incoming.screenEngines
    if (!Array.isArray(screenEngines) || !screenEngines.length || screenEngines.length > 3 || screenEngines.some(engine => ![1, 2, 3].includes(engine)) || new Set(screenEngines).size !== screenEngines.length) invalid('OCR.space 引擎顺序须为不重复的 1、2、3')
    const maxModelCalls = Number(incoming.maxModelCalls === undefined ? base.maxModelCalls || legacy.maxAttempts || 1 : incoming.maxModelCalls)
    if (!Number.isInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > 6) invalid('单次模型请求上限须为 1～6')
    const prompts = {}
    for (const key of Object.keys(PROMPT_DEFAULTS)) {
        const value = incoming[key] === undefined ? base[key] || PROMPT_DEFAULTS[key] : incoming[key]
        if (typeof value !== 'string' || !value.trim() || value.length > 20000) invalid('Prompt 模板不能为空，且每项不能超过 20000 字符')
        prompts[key] = value.trim()
    }
    const primary = modelChain.find(step => step.enabled && providers.some(provider => provider.id === step.providerId && provider.enabled))
    const primaryProvider = primary && providers.find(provider => provider.id === primary.providerId)
    const ocr = providers.find(provider => provider.type === 'ocrspace' && provider.enabled)
    if (!ocr || providers.filter(provider => provider.type === 'ocrspace').length !== 1) invalid('请保留一个启用的 OCR.space 初筛服务')
    return { providers, modelChain, screenEngines, maxModelCalls, ...prompts,
        apiUrl: primaryProvider ? primaryProvider.apiUrl : legacy.apiUrl,
        apiKey: primaryProvider ? primaryProvider.apiKey : '',
        model: primary ? primary.model : legacy.model, textModel: primary ? primary.textModel : legacy.textModel,
        ocrSpaceApiKey: ocr.apiKey, ocrSpaceEngine: screenEngines[0] }
}

/** 按运行时旧字段生成高级配置，环境变量及旧数据库数据保持兼容。 */
function effectiveAdvancedConfig(dbConfig, legacy) {
    const base = Array.isArray(dbConfig.providers) ? { ...dbConfig } : migrate(legacy)
    if (!base.contentPrompt) base.contentPrompt = CONTENT_RECOGNITION_PROMPT
    if (!base.bomPrompt) base.bomPrompt = BOM_PROMPT
    if (!base.orderPrompt) base.orderPrompt = ORDER_PROMPT
    return mergeAdvancedConfig({ ...legacy, ...base }, {}, legacy)
}

/** 返回不包含供应商密钥的配置。 */
function publicAdvancedConfig(config, maskKey) {
    return { providers: config.providers.map(provider => { const { apiKey, ...visible } = provider; return { ...visible, keySet: !!apiKey, maskedKey: maskKey(apiKey) } }),
        modelChain: config.modelChain, screenEngines: config.screenEngines, maxModelCalls: config.maxModelCalls,
        contentPrompt: config.contentPrompt, bomPrompt: config.bomPrompt, orderPrompt: config.orderPrompt }
}

module.exports = { PROVIDERS, PROMPT_DEFAULTS, normalizeProviders, mergeAdvancedConfig, effectiveAdvancedConfig, publicAdvancedConfig }
