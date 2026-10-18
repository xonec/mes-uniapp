'use strict'
const { ClientError } = require('mes-common')
const { normalizeDocument } = require('./document-result')
const { PROVIDERS } = require('ocr-config')

/** 检查是否存在启用且已配置密钥的模型步骤；缓存命中不受此检查影响。 */
function hasReadyModels(config, mode = 'image') {
    return config.modelChain.some(step => step.enabled && config.providers.some(provider => {
        if (provider.id !== step.providerId || !provider.enabled || !provider.apiKey || provider.type === 'ocrspace') return false
        const known = PROVIDERS[provider.type].models.find(model => model.id === step.model)
        return mode === 'text' || !known || known.vision !== false
    }))
}

/** 按配置顺序调用模型，首个有效结果立即返回；所有实际请求共用费用与时间预算。 */
async function recognizeModels({ config, images, text, purpose, uid, deadline, callModel }) {
    const budget = { used: 0, limit: config.maxModelCalls }
    const trace = []
    const steps = config.modelChain.filter(step => step.enabled)
    for (const step of steps) {
        const anyProvider = config.providers.find(item => item.id === step.providerId)
        const provider = anyProvider && anyProvider.enabled && anyProvider.type !== 'ocrspace' ? anyProvider : null
        if (!provider) {
            trace.push({ stepId: step.id, status: 'unconfigured', detail: anyProvider ? ('供应商「' + anyProvider.name + '」已停用') : ('供应商不存在（' + step.providerId + '）') })
            continue
        }
        if (!provider.apiKey) { trace.push({ stepId: step.id, status: 'unconfigured', detail: '供应商「' + provider.name + '」未填写 Key' }); continue }
        if (budget.used >= budget.limit) break
        if (deadline - Date.now() < 1500) break
        const mode = text ? 'text' : 'image'
        if (mode === 'image' && (PROVIDERS[provider.type].models.find(model => model.id === step.model) || {}).vision === false) { trace.push({ stepId: step.id, status: 'unsupported-image' }); continue }
        const pagePrompt = '照片按输入顺序编号1至' + images.length + '。同一物料的名称、规格、版本、单位跨页展示时合并为一行，material_code保留换行前后的完整编码；每行增加source_pages数组标明来源页码。未知页码或物料版本设置null，不能猜填N/A。不得把衬板尺寸当作托盘尺寸。计划件数可为小数，保留原文。'
        const prompt = config.contentPrompt + '\n\n' + (purpose === 'bom' ? config.bomPrompt : config.orderPrompt) + '\n\n' + pagePrompt
        const messages = [
            { role: 'system', content: prompt },
            { role: 'user', content: text || [...images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: '请识别同一张单据的这些照片，完整提取内容，按模板输出 JSON。' }] }
        ]
        const before = budget.used
        try {
            const parsed = await callModel(messages, mode, { ...config, apiUrl: provider.apiUrl, apiKey: provider.apiKey, model: step.model, textModel: step.textModel }, uid, deadline, budget)
            const result = normalizeDocument(parsed)
            if (!result.productCode && !result.productName && !(Array.isArray(result.materials) && result.materials.length)) throw new ClientError('模型返回的 JSON 不包含产品或材料内容', 502)
            trace.push({ stepId: step.id, provider: provider.name, model: mode === 'text' ? step.textModel : step.model, status: 'success', calls: budget.used - before })
            return { ...result, recognitionRaw: parsed, recognitionProvider: provider.name, recognitionModel: mode === 'text' ? step.textModel : step.model, modelTrace: trace,
                recognitionAudit: { contentPrompt: config.contentPrompt, taskPrompt: purpose === 'bom' ? config.bomPrompt : config.orderPrompt, pagePrompt, providerId: provider.id, mode } }
        } catch (error) {
            if (!(error instanceof ClientError) || error.kind === 'quota' || error.kind === 'budget' || error.code === 400) throw error
            // 记录失败原因，便于管理员直接看到是 Key、模型名还是超时问题（不包含任何密钥）
            trace.push({ stepId: step.id, provider: provider.name, model: mode === 'text' ? step.textModel : step.model, status: 'failed', calls: budget.used - before, detail: String(error.message || '调用失败').slice(0, 160) })
        }
    }
    if (!hasReadyModels(config, text ? 'text' : 'image')) throw new ClientError('请在后台启用可用模型步骤并填写对应供应商 Key；尚未调用模型', 503)
    if (budget.used >= budget.limit) throw new ClientError('已达到本次模型请求上限（' + budget.limit + ' 次），未获得可用结果，请核对模型配置或手动录入', 502)
    const notes = trace.map(item => {
        if (item.status === 'failed') return (item.provider || item.stepId) + ' / ' + (item.model || '') + '：' + (item.detail || '调用失败')
        if (item.status === 'unconfigured') return item.detail || '有模型步骤未配置供应商 Key'
        if (item.status === 'unsupported-image') return (item.provider || item.stepId) + ' / ' + (item.model || '') + '：该模型不支持图片识别'
        return ''
    }).filter(Boolean)
    const detail = Array.from(new Set(notes)).slice(0, 4).join('；')
    throw new ClientError('配置顺序中的模型未返回可用结果' + (detail ? '（' + detail + '）' : '') + '，请核对供应商、模型和 Prompt 模板后重试', 502)
}
module.exports = { hasReadyModels, recognizeModels }
