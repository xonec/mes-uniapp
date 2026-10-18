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
    const providerNameOf = step => { const p = config.providers.find(item => item.id === step.providerId); return p ? p.name : '' }
    const modelNameOf = step => (text ? step.textModel : step.model)
    // 记录被跳过的通道及原因：失败摘要要能说清「哪些通道没试、为什么没试」。
    const markSkipped = (fromIndex, reason) => {
        steps.slice(fromIndex).forEach(step => {
            if (trace.some(item => item.stepId === step.id)) return
            trace.push({ stepId: step.id, provider: providerNameOf(step), model: modelNameOf(step), status: 'skipped', detail: reason })
        })
    }
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        const step = steps[stepIndex]
        const stepStarted = Date.now()
        const anyProvider = config.providers.find(item => item.id === step.providerId)
        const provider = anyProvider && anyProvider.enabled && anyProvider.type !== 'ocrspace' ? anyProvider : null
        if (!provider) {
            trace.push({ stepId: step.id, status: 'unconfigured', detail: anyProvider ? ('供应商「' + anyProvider.name + '」已停用') : ('供应商不存在（' + step.providerId + '）') })
            continue
        }
        if (!provider.apiKey) { trace.push({ stepId: step.id, status: 'unconfigured', detail: '供应商「' + provider.name + '」未填写 Key' }); continue }
        if (budget.used >= budget.limit) { markSkipped(stepIndex, '预算不足'); break }
        if (deadline - Date.now() < 1500) { markSkipped(stepIndex, '时间预算不足'); break }
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
            trace.push({ stepId: step.id, provider: provider.name, model: mode === 'text' ? step.textModel : step.model, status: 'success', calls: budget.used - before, ms: Date.now() - stepStarted })
            return { ...result, recognitionRaw: parsed, recognitionProvider: provider.name, recognitionModel: mode === 'text' ? step.textModel : step.model, modelTrace: trace,
                recognitionAudit: { contentPrompt: config.contentPrompt, taskPrompt: purpose === 'bom' ? config.bomPrompt : config.orderPrompt, pagePrompt, providerId: provider.id, mode } }
        } catch (error) {
            // 预算/额度类错误直接终止整条链，先补上本步失败记录与被跳过通道，再挂到 error 上，
            // 否则上层 buildModelFailure 拿不到 trace，只能给出「已达到请求上限」一句话。
            if (error instanceof ClientError && (error.kind === 'quota' || error.kind === 'budget')) {
                trace.push({ stepId: step.id, provider: provider.name, model: mode === 'text' ? step.textModel : step.model, status: 'failed', calls: budget.used - before, ms: Date.now() - stepStarted, detail: String(error.message || '预算不足').slice(0, 160) })
                markSkipped(stepIndex + 1, error.kind === 'budget' ? '预算不足' : '额度不足')
                error.trace = trace
                error.budget = { used: budget.used, limit: budget.limit }
                throw error
            }
            if (!(error instanceof ClientError) || error.code === 400) {
                if (trace.length && !error.trace) error.trace = trace
                throw error
            }
            // 记录失败原因，便于管理员直接看到是 Key、模型名还是超时问题（不包含任何密钥）
            trace.push({ stepId: step.id, provider: provider.name, model: mode === 'text' ? step.textModel : step.model, status: 'failed', calls: budget.used - before, ms: Date.now() - stepStarted, detail: String(error.message || '调用失败').slice(0, 160) })
        }
    }
    const traced = (message, code) => { const error = new ClientError(message, code); error.trace = trace; return error }
    if (!hasReadyModels(config, text ? 'text' : 'image')) throw traced('请在后台启用可用模型步骤并填写对应供应商 Key；尚未调用模型', 503)
    if (budget.used >= budget.limit) {
        markSkipped(0, '预算不足')
        console.warn('[doc-ocr] 模型请求预算耗尽 used=' + budget.used + ' limit=' + budget.limit + ' trace=' + JSON.stringify(trace).slice(0, 600))
        const budgetError = traced('已达到本次模型请求上限（' + budget.limit + ' 次），未获得可用结果，请核对模型配置或手动录入', 502)
        budgetError.budget = { used: budget.used, limit: budget.limit }
        throw budgetError
    }
    const notes = trace.map(item => {
        if (item.status === 'failed') return (item.provider || item.stepId) + ' / ' + (item.model || '') + '：' + (item.detail || '调用失败')
        if (item.status === 'unconfigured') return item.detail || '有模型步骤未配置供应商 Key'
        if (item.status === 'unsupported-image') return (item.provider || item.stepId) + ' / ' + (item.model || '') + '：该模型不支持图片识别'
        return ''
    }).filter(Boolean)
    const detail = Array.from(new Set(notes)).slice(0, 4).join('；')
    throw traced('配置顺序中的模型未返回可用结果' + (detail ? '（' + detail + '）' : '') + '，请核对供应商、模型和 Prompt 模板后重试', 502)
}
module.exports = { hasReadyModels, recognizeModels }
