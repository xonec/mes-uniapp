'use strict'

// 云函数：doc-ocr —— 包装指令单识别与存储
//   action = 'recognize'：图片 base64（小程序）或本地 OCR 文本（App）→ 识别服务结构化字段（需登录）
//   action = 'save'     ：确认后的字段写入 production_orders（_id = order:<订单号>，需登录）
//   action = 'getConfig'：读取识别服务配置（admin 专用，Key 脱敏返回）
//   action = 'setConfig'：写入识别服务配置（admin 专用，无需重传云函数即可切换供应商/限额）
//
// 图片先由 OCR.space 初筛编码，再实时查档案；已有产品跳过模型，新产品才完整识别。
// 配置优先级：DB 集合 config(_id=ocr) > 环境变量 > 默认值 / OCR.space 配置中心。
//   - 环境变量（控制台配置，冷启动生效，无需重传）：
//       DEEPSEEK_API_KEY  识别服务 Key（也可用兼容旧名 SF_API_KEY）
//       OCR_API_URL / OCR_MODEL / OCR_TEXT_MODEL / OCR_API_TIMEOUT / OCR_MAX_ATTEMPTS
//       OCR_DAILY_LIMIT      全局每日识别上限（默认 200，0=不限）
//       OCR_USER_DAILY_LIMIT 每用户每日识别上限（默认 100，0=不限）
//       OCR_DEDUP_MINUTES    相同输入复用分钟（默认 10080，省钱模式至少 7 天）
//       OCRSPACE_API_KEY / OCRSPACE_ENGINE 免费 OCR Key 与引擎（默认 2）
//   - DB 配置（App「识别设置」页填，60s 内生效，无需进控制台）：同上字段 + apiKey + dailyLimit/userDailyLimit/dedupMinutes。
//
// 额度保护：每次模型 HTTP 尝试前检查当日全局/个人上限（含重试），超限直接拦截；
//          并对相同图片/文本做去重缓存，重复提交不重复计费；每次调用打印 token 用量便于监控。

const { checkAuth, checkAdmin, ok, fail, ClientError } = require('mes-common')
const { buildMaterialsFromArchive } = require('order-parser')
const { DEFAULT_OCR_CONFIG, PROVIDER_PRESETS, PROVIDERS, PROMPT_DEFAULTS, publicAdvancedConfig, maskApiKey, mergeOcrConfig, effectiveConfig } = require('ocr-config')
const { saveOrder, updatedCount } = require('mes-document-store')
const { recordRecognition, readArchivedImages, ensureSource, validateSourceReference } = require('mes-document-store/source-store')
const { createHash } = require('crypto')
const { readRecognition, assertRecognitionOwner, acquireRecognition, completeRecognition, failRecognition } = require('./request-cache')
const { configuredKey, recognizeFree, parsePages: parseFreePages } = require('./ocr-space')
const { originalUploadPrefix, validateOriginalIds, loadOriginalImages, cleanupOriginalImages } = require('./original-images')
const { getModels } = require('./model-catalog')
const { hasReadyModels, recognizeModels } = require('./model-chain')

const CONFIG_COLL = 'config'
const CONFIG_ID = 'ocr'
const QUOTA_COLL = 'ocr_quota'
const OCR_PROTOCOL_VERSION = 4

// 环境变量解析的兜底默认（DB 配置空白时回落到这里）
const FALLBACK = {
    apiUrl: process.env.OCR_API_URL || process.env.SF_API_URL || DEFAULT_OCR_CONFIG.apiUrl,
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.SF_API_KEY || '',
    model: process.env.OCR_MODEL || process.env.SF_MODEL || DEFAULT_OCR_CONFIG.model,
    textModel: process.env.OCR_TEXT_MODEL || process.env.SF_TEXT_MODEL || DEFAULT_OCR_CONFIG.textModel,
    timeout: Number(process.env.OCR_API_TIMEOUT) || DEFAULT_OCR_CONFIG.timeout,
    maxAttempts: Number(process.env.OCR_MAX_ATTEMPTS) || DEFAULT_OCR_CONFIG.maxAttempts,
    dailyLimit: process.env.OCR_DAILY_LIMIT !== undefined ? Number(process.env.OCR_DAILY_LIMIT) : DEFAULT_OCR_CONFIG.dailyLimit,
    userDailyLimit: process.env.OCR_USER_DAILY_LIMIT !== undefined ? Number(process.env.OCR_USER_DAILY_LIMIT) : DEFAULT_OCR_CONFIG.userDailyLimit,
    dedupMinutes: process.env.OCR_DEDUP_MINUTES !== undefined ? Number(process.env.OCR_DEDUP_MINUTES) : DEFAULT_OCR_CONFIG.dedupMinutes,
    ocrSpaceApiKey: configuredKey(),
    ocrSpaceEngine: Number(process.env.OCRSPACE_ENGINE) || 2
}

let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

// 运行时配置缓存（同容器 60s 内复用；setConfig 会主动清缓存立即生效）
let _cfgCache = null
let _cfgTs = 0
const CFG_TTL = 60000
async function resolveOcrConfig() {
    const now = Date.now()
    if (_cfgCache && now - _cfgTs < CFG_TTL) return _cfgCache
    const dbCfg = await readDbConfig()
    _cfgCache = effectiveConfig(dbCfg, FALLBACK)
    _cfgTs = now
    return _cfgCache
}

// ---------- 大模型配额（北京时间日历日） ----------
function dateStr() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}
async function reserveCounter(id, date, limit, label) {
    const coll = db.collection(QUOTA_COLL)
    const rows = (await coll.doc(id).get()).data || []
    if (!rows.length) {
        try { await coll.add({ _id: id, calls: 0, date }) }
        catch (error) { if (!/duplicate|exist|already/i.test(String(error.message || error.errMsg || error))) throw error }
    }
    const where = { _id: id }
    if (limit > 0) where.calls = db.command.lt(limit)
    if (!updatedCount(await coll.where(where).update({ calls: db.command.inc(1) }))) {
        throw new ClientError(label + '今日识别已达上限，请次日再试或联系管理员', 429)
    }
}
// 每次真实调用大模型前检查当日全局/个人上限；超限直接拦截（不发起请求）
async function assertWithinQuota(cfg, uid) {
    const today = dateStr()
    const gId = 'g:' + today
    const uId = 'u:' + today + ':' + uid
    const gLimit = Number(cfg.dailyLimit) || 0
    const uLimit = Number(cfg.userDailyLimit) || 0
    await reserveCounter(uId, today, uLimit, '您')
    try { await reserveCounter(gId, today, gLimit, '全局') }
    catch (error) {
        await db.collection(QUOTA_COLL).doc(uId).update({ calls: db.command.inc(-1) })
        throw error
    }
}

// ---------- 去重缓存（相同输入不重复计费） ----------
async function dedupKey(event, purpose, cfg, stage) {
    const configuration = stage === 'model' ? { chain: cfg.modelChain.filter(step => step.enabled).map(step => ({ ...step, apiUrl: (cfg.providers.find(provider => provider.id === step.providerId && provider.enabled) || {}).apiUrl || '' })), prompt: cfg.contentPrompt, extraPrompt: purpose === 'bom' ? cfg.bomPrompt : cfg.orderPrompt } : { engines: cfg.screenEngines }
    const raw = JSON.stringify({ revision: stage === 'model' ? 9 : 7, purpose, imageHashes: Array.from(new Set(event.imageHashes || [])), text: event.text || '', stage, configuration })
    return 'c:' + createHash('sha256').update(raw).digest('hex')
}

/** 校验原图/预处理图内容哈希及对应数量，上传后再按实际字节复核。 */
function validateImageHashes(hashes, expectedCount) {
    if (!Array.isArray(hashes) || !hashes.length || hashes.length > 6 || hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) || (expectedCount !== undefined && hashes.length !== expectedCount)) throw new ClientError('图片内容校验信息缺失或不一致，请清空照片后重新选择', 400)
    return hashes
}

// 数据库确认没有此产品后调用大模型；每个模型的重试与全部模型共用总请求上限。
// mode = 'image' 用多模态模型；mode = 'text' 用文本兜底模型
async function callSF(messages, mode, cfg, uid, deadline, budget) {
    if (!String(cfg.apiKey || '').trim()) {
        throw new ClientError('服务端未配置识别服务 Key：请在 App「识别设置」填写，或在云函数控制台配置环境变量 DEEPSEEK_API_KEY')
    }
    const model = mode === 'text' ? cfg.textModel : cfg.model
    const body = {
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1
    }
    const MAX_ATTEMPTS = Number(cfg.maxAttempts) || DEFAULT_OCR_CONFIG.maxAttempts
    const PER_CALL_TIMEOUT = Number(cfg.timeout) || DEFAULT_OCR_CONFIG.timeout   // 单次调用上限；留足函数总超时余量
    const BACKOFF = [4000, 6000]            // 失败后退避间隔（指数退避）
    const startedAt = Date.now()
    const TOTAL_BUDGET = 155000 // 为支付宝云 180 秒函数上限留出鉴权和数据库操作时间
    let lastErr = '识别服务调用失败'
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (budget && budget.used >= budget.limit) { const error = new ClientError('已达到本次模型请求上限', 429); error.kind = 'budget'; throw error }
        if (attempt > 0) await new Promise(r => setTimeout(r, BACKOFF[attempt - 1] || 4000))
        const remaining = Math.min(TOTAL_BUDGET - (Date.now() - startedAt), deadline ? deadline - Date.now() : Infinity)
        if (remaining < 1000) break
        // 每一次实际 HTTP 尝试都占额度，防止重试次数与供应商计费次数不一致。
        try { await assertWithinQuota(cfg, uid) }
        catch (error) { if (error instanceof ClientError) error.kind = 'quota'; throw error }
        if (budget) budget.used++
        try {
            const res = await uniCloud.httpclient.request(cfg.apiUrl, {
                method: 'POST',
                contentType: 'json',
                dataType: 'json',
                followRedirect: false,
                timeout: Math.min(PER_CALL_TIMEOUT, remaining),
                headers: { Authorization: 'Bearer ' + cfg.apiKey },
                data: body
            })
            const data = res && res.data
            const status = Number(res && (res.status || res.statusCode))
            if (status >= 400 && status < 500 && status !== 429) throw new ClientError('识别服务拒绝请求，请在 OCR 配置中检查模型名和 API Key', 502)
            // 支付宝云 httpclient 的 statusCode 不一定可靠，直接按响应内容判定成功与否
            if (!data || !data.choices || !data.choices[0]) {
                lastErr = '识别服务返回异常，请核对供应商和模型配置'
                continue
            }
            const content = data.choices[0].message && data.choices[0].message.content
            try {
                const parsed = JSON.parse(String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
                if (data.usage) console.log('[doc-ocr] 用量 mode=' + mode + ' ' + JSON.stringify(data.usage))
                return parsed
            } catch (e) {
                lastErr = '模型返回无法解析为 JSON'
                continue
            }
        } catch (e) {
            if (e instanceof ClientError) throw e
            // httpclient 超时 / 网络异常：典型为高峰排队，继续重试
            lastErr = '识别服务请求失败或超时'
            continue
        }
    }
    throw new ClientError(lastErr, 502)
}

/** OCR.space 按管理员配置的引擎顺序初筛，所有引擎共用 90 秒预算。 */
async function recognizeScreen(images, config, purpose, deadline) {
    const screenDeadline = Math.min(deadline, Date.now() + 90000)
    let result = null
    for (const engine of config.screenEngines) {
        if (screenDeadline - Date.now() < 1500) break
        try {
            const found = await recognizeFree(images, { ...config, ocrSpaceEngine: engine }, purpose, { screenOnly: true, budgetMs: screenDeadline - Date.now(), deadline: screenDeadline })
            result = found
            if ((found.detectedProductCodes || []).length > 1 || /^\d{10}$/.test(String(found.productCode || ''))) return found
        } catch (error) {
            if (!(error instanceof ClientError)) throw error
            if (error.code === 400) throw error
        }
    }
    return result || parseFreePages([{ ParsedText: '' }], purpose)
}

// 服务端轻校验：批号 11 位字母数字；产品编码 10 位数字；订单号纯数字
function validateFields(f) {
    f = f && typeof f === 'object' && !Array.isArray(f) ? f : {}
    const uncertain = Array.isArray(f.uncertain) ? f.uncertain : []
    const marks = {}
    const checks = [
        ['orderNo', /^\d{4,12}$/],
        ['batchNo', /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{11}$/],
        ['productCode', /^\d{10}$/],
        ['plannedQty', (v) => v === '' || v === undefined || v === null || (!isNaN(Number(v)) && Number(v) >= 0)]
    ]
    for (const [k, re] of checks) {
        const v = f[k]
        if (v === undefined || v === null || v === '') {
            if (uncertain.indexOf(k) < 0) uncertain.push(k)
            marks[k] = false
            continue
        }
        const passed = typeof re === 'function' ? re(v) : re.test(String(v))
        marks[k] = passed
        if (!passed && uncertain.indexOf(k) < 0) uncertain.push(k)
    }
    return { ...f, uncertain }
}

/** BOM 识别只向页面返回所需档案字段和待核对标记。 */
function validateBomFields(value) {
    const f = value && typeof value === 'object' ? value : {}
    const uncertain = Array.isArray(f.uncertain) ? f.uncertain.filter(v => typeof v === 'string') : []
    const output = {
        productCode: String(f.productCode || '').trim(),
        productName: String(f.productName || '').trim().slice(0, 120),
        packSpec: String(f.packSpec || '').trim().slice(0, 500),
        materials: (Array.isArray(f.materials) ? f.materials : []).slice(0, 200).map((row, index) => ({
            seq: index + 1,
            materialCode: String(row && row.materialCode || '').replace(/\s+/g, ''),
            materialName: String(row && row.materialName || '').trim().slice(0, 120),
            spec: String(row && row.spec || '').trim().slice(0, 2000),
            materialVersion: String(row && row.materialVersion || '').trim().slice(0, 20) || null,
            unit: String(row && row.unit || '').trim().slice(0, 12), sourcePages: Array.isArray(row && row.sourcePages) ? row.sourcePages : []
        }))
    }
    for (const field of ['productCode', 'productName', 'packSpec']) {
        if ((!output[field] || (field === 'productCode' && !/^\d{10}$/.test(output[field]))) && !uncertain.includes(field)) uncertain.push(field)
    }
    if ((!output.materials.length || output.materials.some(row => !row.materialCode || !row.unit)) && !uncertain.includes('materials')) uncertain.push('materials')
    return { ...output, uncertain, ...(f.recognitionDocument ? { recognitionDocument: f.recognitionDocument } : {}), ...(f.recognitionProvider ? { recognitionProvider: f.recognitionProvider, recognitionModel: f.recognitionModel, modelTrace: f.modelTrace, recognitionRaw: f.recognitionRaw, recognitionAudit: f.recognitionAudit } : {}) }
}

// 查库失败必须中止，不能误判“没有产品”后产生模型费用；停用档案也视为已有。
async function fetchArchive(productCode) {
    const code = String(productCode || '').trim()
    if (!code) return null
    const response = await db.collection('product_materials').doc('mat:' + code).get()
    if (!response || !Array.isArray(response.data)) throw new ClientError('产品档案暂时无法查询，已停止识别，请稍后重试', 503)
    return response.data[0] || null
}

/** 返回最新档案的四项 BOM 内容；订单字段继续使用本次初筛，不写入产品主档案。 */
function archiveResult(screened, archive, purpose) {
    const bom = validateBomFields({ ...archive, materials: buildMaterialsFromArchive(archive), uncertain: [] })
    const fields = purpose === 'bom' ? bom : validateFields({ ...screened, rawPackSpec: screened.rawPackSpec || screened.packSpec || '', productCode: bom.productCode, productName: bom.productName, packSpec: bom.packSpec,
        materials: Array.isArray(screened.materials) ? screened.materials : [], uncertain: Array.from(new Set([...(screened.uncertain || []).filter(field => !['productCode', 'productName'].includes(field)), 'materials'])) })
    return {
        ...fields,
        recognitionDocument: screened.recognitionDocument, recognitionRaw: screened.recognitionRaw,
        recognitionProvider: screened.recognitionProvider, recognitionModel: screened.recognitionModel,
        modelTrace: screened.modelTrace, recognitionAudit: screened.recognitionAudit,
        ...(purpose === 'bom' ? { enabled: archive.enabled !== false, version: Number(archive.version) || 1, source: archive.source || 'manual' } : {}),
        archiveMatched: true, archiveDisabled: archive.enabled === false, modelUsed: false, needsProductCodeConfirmation: false,
        recognitionSource: 'archive',
        message: archive.enabled === false ? '已找到产品档案并跳过 AI，但档案已停用，请由管理员核对并启用后使用。' : purpose === 'order' ? '已找到产品信息，未调用大模型。请选择客户包装方案并核对本单材料，避免同编码套用其他客户BOM。' : '已找到产品档案，直接载入最新 BOM，未调用大模型。'
    }
}

/** 初筛与模型编码不一致时要求人工确认，重复确认优先复用同一模型结果。 */
function modelResult(fields, productCode, confirmedCode, cached, purpose) {
    const mismatch = !/^\d{10}$/.test(fields.productCode) || fields.productCode !== productCode
    if (mismatch && confirmedCode) {
        fields = { ...fields, productCode: confirmedCode, uncertain: Array.from(new Set([...(fields.uncertain || []), 'productCode'])) }
    }
    return {
        ...fields, source: 'photo', archiveMatched: false, modelUsed: !cached, recognitionSource: cached ? 'cache' : 'model',
        needsProductCodeConfirmation: mismatch && !confirmedCode,
        message: (mismatch ? (confirmedCode ? '已使用你确认的产品编码；它与模型结果有差异，请核对名称、规格和材料是否属于该产品。' : '初筛与模型的产品编码不一致或编码不清楚，请核对并确认编码后继续；已有模型结果会复用。') : cached ? '已复用大模型识别结果，本次未请求大模型；请核对后保存。' : '已调用大模型完整识别本次单据；请核对后保存。') + (purpose === 'order' ? '请选择客户，核对本单材料和上托要求。' : '产品档案确认入库后，后续导入可复用档案。')
    }
}

/** 主动大模型识别获得编码后查库；已有产品载入档案，未知或模糊编码仍需人工确认。 */
async function finishModelResult(fields, productCode, confirmedCode, expectedCode, cached, purpose) {
    if (/^\d{10}$/.test(productCode)) {
        const archive = fields.productCode === productCode ? await fetchArchive(productCode) : null
        const result = modelResult(fields, productCode, confirmedCode, cached, purpose)
        if (archive) return { ...result, archiveMatched: true, archiveDisabled: archive.enabled === false, ...(purpose === 'order' ? { rawPackSpec: fields.rawPackSpec || fields.packSpec, productName: archive.productName, packSpec: archive.packSpec } : { enabled: archive.enabled !== false, version: Number(archive.version) || 1 }) }
        return result
    }
    const modelCode = String(fields.productCode || '').trim()
    fields = { ...fields, productCode: modelCode }
    if (!/^\d{10}$/.test(modelCode) || (fields.uncertain || []).includes('productCode')) {
        return { ...modelResult(fields, '', '', cached, purpose), message: '大模型仍未能确认产品编码，请核对照片并填写 10 位编码后继续；本次模型结果会复用，无需再次识别整张照片。' }
    }
    if (expectedCode && modelCode !== expectedCode) throw new ClientError('大模型识别出的产品编码与当前产品不一致，请在新增入口导入；识别结果已缓存', 409)
    const archive = await fetchArchive(modelCode)
    if (archive) {
        return {
            ...modelResult(fields, modelCode, '', cached, purpose), archiveMatched: true, archiveDisabled: archive.enabled === false,
            ...(purpose === 'order' ? { rawPackSpec: fields.rawPackSpec || fields.packSpec, productName: archive.productName, packSpec: archive.packSpec } : {}),
            ...(purpose === 'bom' ? { enabled: archive.enabled !== false, version: Number(archive.version) || 1 } : {}),
            message: (cached ? '已复用大模型识别结果，本次未调用大模型。' : '已使用原图完整识别本次单据。') + (archive.enabled === false ? '产品档案已停用，请由管理员核对。' : '产品已建档，请按本单核对材料并选择客户方案。')
        }
    }
    return modelResult(fields, modelCode, '', cached, purpose)
}

// 读取 DB 中的 OCR 配置文档（不存在返回 {}）
async function readDbConfig() {
    try {
        const response = await db.collection(CONFIG_COLL).doc(CONFIG_ID).get()
        if (!response || !Array.isArray(response.data)) throw new Error('配置查询响应异常')
        return response.data[0] || {}
    } catch (e) {
        throw new ClientError('OCR 配置暂时无法读取，请稍后重试；已停止识别和配置保存', 503)
    }
}

exports.main = async (event) => {
    event = event || {}
    const recognitionDeadline = Date.now() + 165000
    let recognitionKey = '', recognitionOwner = '', productRecognitionKey = '', productRecognitionOwner = ''
    let originalIdsToCleanup = []
    let uploadLeaseKey = '', uploadLeaseOwner = '', retainUploadLease = false
    try {
        db = getDb()
        // 配置读写：管理员专用（先过基础鉴权，再过 admin）
        if (event.action === 'getConfig' || event.action === 'setConfig' || event.action === 'getModels') {
            const admin = await checkAdmin(db, event.uniIdToken)
            if (admin.errCode) return fail(admin.errCode, admin.message)
            if (event.action === 'getModels') {
                // 管理员刷新模型列表必须使用最新 Key，与 getConfig 一致，避免识别配置缓存保留已更换的 Key。
                const latest = effectiveConfig(await readDbConfig(), FALLBACK)
                return ok(await getModels(latest, event.provider || event.providerId, event.forceRefresh === true))
            }
            if (event.action === 'getConfig') {
                const dbCfg = await readDbConfig()
                const eff = effectiveConfig(dbCfg, FALLBACK)
                return ok({
                    ocrSpaceKeySet: !!String(eff.ocrSpaceApiKey || '').trim(),
                    ocrSpaceMaskedKey: maskApiKey(eff.ocrSpaceApiKey),
                    keySet: !!String(eff.apiKey || '').trim(),
                    updatedAt: Number(dbCfg.updatedAt) || 0,
                    maskedKey: maskApiKey(eff.apiKey),
                    source: String(dbCfg.apiKey || '').trim() ? 'db' : (String(FALLBACK.apiKey || '').trim() ? 'env' : 'default'),
                    config: {
                        ...publicAdvancedConfig(eff, maskApiKey),
                        apiUrl: eff.apiUrl,
                        model: eff.model,
                        textModel: eff.textModel,
                        timeout: eff.timeout,
                        maxAttempts: eff.maxAttempts,
                        dailyLimit: eff.dailyLimit,
                        userDailyLimit: eff.userDailyLimit,
                        dedupMinutes: eff.dedupMinutes,
                        economyMode: eff.economyMode,
                        ocrSpaceEngine: eff.ocrSpaceEngine
                    },
                    presets: PROVIDER_PRESETS, providerCatalog: PROVIDERS, promptDefaults: PROMPT_DEFAULTS
                })
            }
            // setConfig：合并保存（未重填的字段保留原值，尤其是 Key）
            const i = event.config || {}
            if (i.economyMode !== undefined && typeof i.economyMode !== 'boolean') return fail(400, '省钱模式状态非法')
            const existing = await readDbConfig()
            if (event.expectedUpdatedAt !== undefined && Number(event.expectedUpdatedAt) !== (Number(existing.updatedAt) || 0)) return fail(409, 'OCR 配置已被其他管理员修改，请重新加载后核对再保存')
            const merged = mergeOcrConfig(effectiveConfig(existing, FALLBACK), i)
            if (!/^https?:\/\//.test(merged.apiUrl)) return fail(400, 'API 地址必须以 http(s):// 开头')
            if (!String(merged.model || '').trim() || !String(merged.textModel || '').trim()) {
                return fail(400, '图片模型与文本模型均不能为空')
            }
            if (!Number.isInteger(merged.maxAttempts) || merged.maxAttempts < 1 || merged.maxAttempts > 3 || merged.timeout < 5000 || merged.timeout > 60000) return fail(400, '超时须为 5000～60000 毫秒，最多尝试次数须为 1～3（含首次）')
            if (![1, 2, 3].includes(merged.ocrSpaceEngine)) return fail(400, 'OCR.space 引擎须为 1、2 或 3')
            if (!hasReadyModels(merged) && !String(merged.ocrSpaceApiKey || '').trim()) {
                return fail(400, '请至少配置 OCR.space Key；大模型 Key 可留空')
            }
            const doc = Object.assign({}, merged, { _id: CONFIG_ID, updatedAt: Math.max(Date.now(), (Number(existing.updatedAt) || 0) + 1), updatedBy: admin.uid })
            const collection = db.collection(CONFIG_COLL)
            if (existing._id) {
                const { _id, ...update } = doc
                const where = { _id: CONFIG_ID, updatedAt: existing.updatedAt === undefined ? db.command.exists(false) : existing.updatedAt }
                if (!updatedCount(await collection.where(where).update(update))) return fail(409, 'OCR 配置已被其他管理员修改，请重新加载后核对再保存')
            } else {
                try { await collection.add(doc) }
                catch (error) { if (/duplicate|already.*exist|document.*exist|重复|已存在|E11000/i.test(String(error.message || error.errMsg || error))) return fail(409, 'OCR 配置已被其他管理员创建，请重新加载'); throw error }
            }
            _cfgCache = null   // 立即生效
            return ok({ keySet: !!merged.apiKey, maskedKey: maskApiKey(merged.apiKey), ocrSpaceKeySet: !!merged.ocrSpaceApiKey, ocrSpaceMaskedKey: maskApiKey(merged.ocrSpaceApiKey) })
        }

        const auth = await checkAuth(db, event.uniIdToken)
        if (auth.errCode) return fail(auth.errCode, auth.message)

        if (event.action === 'getCapabilities') return ok({ protocolVersion: OCR_PROTOCOL_VERSION, flow: 'archive-first', multiImage: true, maxImages: 6, modelFallback: true, originalImages: true, hashPreflight: true, sourceTrace: true })

        if (event.action === 'cleanupOriginals') {
            await assertRecognitionOwner(db, event.uploadKey, event.uploadOwner)
            uploadLeaseKey = event.uploadKey; uploadLeaseOwner = event.uploadOwner
            if (Array.isArray(event.originalFileIds) && event.originalFileIds.length) await cleanupOriginalImages(validateOriginalIds(event.originalFileIds, auth.uid, undefined, uploadLeaseOwner))
            return ok({ cleaned: true })
        }

        // 识别：图片 base64（小程序）或本地 OCR 文本（App）→ 结构化字段
        if (event.action === 'recognize' || event.action === 'checkRecognition') {
            const preflight = event.action === 'checkRecognition'
            if (event.protocolVersion !== undefined && event.protocolVersion !== OCR_PROTOCOL_VERSION) return fail(426, '图片识别参数版本不匹配，请更新前端并重新上传 doc-ocr')
            if (event.useModel !== undefined && typeof event.useModel !== 'boolean') return fail(400, '识别方式非法')
            const modelFallback = event.useModel === true
            const confirmedCode = String(event.confirmedProductCode || '').trim()
            const expectedCode = String(event.expectedProductCode || '').trim()
            if ((confirmedCode && !/^\d{10}$/.test(confirmedCode)) || (expectedCode && !/^\d{10}$/.test(expectedCode))) return fail(400, '确认的产品编码须为 10 位数字')
            const text = String(event.text || '').trim().slice(0, 16000)
            if (preflight && text) return fail(400, '上传前校验只接受图片哈希')
            const imageBase64 = String(event.imageBase64 || '')
            const submittedImages = Array.isArray(event.images) ? event.images : (imageBase64 ? [imageBase64] : [])
            if (submittedImages.length > 6 || submittedImages.some(image => typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image))) return fail(400, '最多上传 6 张 JPG、PNG、WebP 或 GIF 图片')
            const images = Array.from(new Set(submittedImages))
            if (images.reduce((total, image) => total + image.length, 0) > 6 * 1024 * 1024) return fail(400, '图片总大小过大，请压缩或减少图片')
            const originalHashes = text ? [] : validateImageHashes(event.originalHashes)
            if (new Set(originalHashes).size !== originalHashes.length) return fail(400, '原图内容重复，请重新选择照片')
            const processedHashes = text ? [] : validateImageHashes(event.processedHashes, originalHashes.length)
            let suppliedArchive = false
            if (event.sourceDocumentId !== undefined) {
                if (preflight || text || images.length || event.originalFileIds !== undefined) throw new ClientError('原图归档参数须分阶段提交', 400)
                await assertRecognitionOwner(db, event.uploadKey, event.uploadOwner)
                uploadLeaseKey = event.uploadKey; uploadLeaseOwner = event.uploadOwner
                const source = await ensureSource(db, auth.uid, originalHashes)
                if (source._id !== event.sourceDocumentId) throw new ClientError('归档原图与本组选图不一致', 400)
                await validateSourceReference(db, source._id, '', auth.uid, false)
                suppliedArchive = true
            }
            if (submittedImages.length && submittedImages.length !== processedHashes.length) return fail(400, '预处理图片数量与内容校验信息不一致')
            for (let index = 0; index < submittedImages.length; index++) {
                const bytes = Buffer.from(submittedImages[index].slice(submittedImages[index].indexOf(',') + 1), 'base64')
                if (createHash('sha256').update(bytes).digest('hex') !== processedHashes[index]) return fail(400, '预处理图片内容校验失败，请重新选图；尚未调用 OCR')
            }
            if (preflight && (images.length || event.originalFileIds !== undefined)) return fail(400, '上传前校验只接受图片哈希')
            if (images.length && event.originalFileIds !== undefined) return fail(400, '预处理图和原图须分阶段上传')
            if (event.originalFileIds !== undefined) {
                await assertRecognitionOwner(db, event.uploadKey, event.uploadOwner)
                uploadLeaseKey = event.uploadKey; uploadLeaseOwner = event.uploadOwner
                originalIdsToCleanup = validateOriginalIds(event.originalFileIds, auth.uid, originalHashes.length, uploadLeaseOwner)
            } else if (images.length && !text) {
                await assertRecognitionOwner(db, event.uploadKey, event.uploadOwner)
                uploadLeaseKey = event.uploadKey; uploadLeaseOwner = event.uploadOwner
            }
            if (!text && !images.length && !preflight && !originalIdsToCleanup.length && !suppliedArchive) return fail(400, '缺少图片数据或 OCR 文本')
            const purpose = event.purpose === 'bom' ? 'bom' : 'order'
            const cfg = await resolveOcrConfig()
            const publish = async (result, modelImages = []) => ok(await recordRecognition(db, { uid: auth.uid, originalHashes, processedHashes, text, purpose, result, config: cfg, modelImages }))
            const dedupMinutes = Number(cfg.dedupMinutes) || 0
            // 即使关闭长期去重，本次人工确认仍可复用 30 分钟内的结果，避免二次付费。
            const retainedMinutes = Math.max(30, dedupMinutes)
            const reuseMinutes = confirmedCode || modelFallback || originalIdsToCleanup.length || suppliedArchive ? retainedMinutes : dedupMinutes
            const input = { imageHashes: processedHashes, text }
            let screened
            // 初筛单独缓存，不随大模型配置变化而重新消耗免费 OCR 额度。
            if (!text) {
                recognitionKey = await dedupKey(input, purpose, cfg, 'screen')
                if (images.length && uploadLeaseKey !== 'upload:' + recognitionKey) throw new ClientError('OCR 配置已变化，请重新识别；尚未调用 OCR', 409)
                if (modelFallback) {
                    // 用户主动选择后直接进入模型；复用可用初筛编码查库，不再等待 OCR.space。
                    screened = await readRecognition(db, recognitionKey, retainedMinutes) || parseFreePages([{ ParsedText: '' }], purpose)
                } else if (preflight || !images.length) {
                    screened = await readRecognition(db, recognitionKey, reuseMinutes, true)
                    if (!screened) {
                        if (originalIdsToCleanup.length) throw new ClientError('初筛结果已过期，请重新识别；尚未调用大模型', 409)
                        const lease = await acquireRecognition(db, 'upload:' + recognitionKey, 0, '相同照片', 600000)
                        uploadLeaseKey = 'upload:' + recognitionKey; uploadLeaseOwner = lease.owner
                        retainUploadLease = true
                        return ok({ needsProcessedImages: true, uploadKey: uploadLeaseKey, uploadOwner: uploadLeaseOwner, modelUsed: false })
                    }
                } else {
                    const acquired = await acquireRecognition(db, recognitionKey, reuseMinutes)
                    if (acquired.cached) screened = acquired.cached
                    else {
                        recognitionOwner = acquired.owner
                        screened = await recognizeScreen(images, cfg, purpose, recognitionDeadline)
                        screened = { ...screened, ...(purpose === 'bom' ? validateBomFields(screened) : validateFields(screened)) }
                        await completeRecognition(db, recognitionKey, recognitionOwner, screened, retainedMinutes)
                        recognitionOwner = ''
                    }
                }
                if (images.length && uploadLeaseOwner) {
                    await completeRecognition(db, uploadLeaseKey, uploadLeaseOwner, {}, 0)
                    uploadLeaseKey = ''; uploadLeaseOwner = ''
                }
            } else {
                screened = parseFreePages([{ ParsedText: text }], purpose)
                screened = { ...screened, ...(purpose === 'bom' ? validateBomFields(screened) : validateFields(screened)) }
            }
            if ((screened.detectedProductCodes || []).length > 1) return fail(400, '照片包含不同产品编码，请按产品分开导入，已停止大模型识别')
            const candidateCode = confirmedCode || String(screened.productCode || '').trim()
            const productCode = /^\d{10}$/.test(candidateCode) ? candidateCode : ''
            if (!productCode && !modelFallback) {
                return await publish({ ...screened, archiveMatched: false, modelUsed: false, needsProductCodeConfirmation: true, canUseModelFallback: true, recognitionSource: text ? 'local' : 'ocrspace', message: '初筛未能确认 10 位产品编码，尚未调用大模型。可点击“使用大模型识别”自动提取，或确认编码后先查库。' })
            }
            if (expectedCode && productCode && productCode !== expectedCode) return fail(409, '照片中的产品编码与当前产品不一致，请在新增入口导入；未调用大模型')
            if (productCode) screened = { ...screened, productCode, uncertain: (screened.uncertain || []).filter(field => field !== 'productCode') }
            let archive = await fetchArchive(productCode)
            if (archive && !modelFallback) return await publish(archiveResult(screened, archive, purpose))
            const modelInput = { imageHashes: originalHashes, text }
            let archivedImages = null
            recognitionKey = await dedupKey(modelInput, purpose, cfg, 'model')
            if (!text && !originalIdsToCleanup.length) {
                const cached = await readRecognition(db, recognitionKey, reuseMinutes, true)
                if (cached) return await publish(await finishModelResult(cached, productCode, confirmedCode, expectedCode, true, purpose))
                if (!hasReadyModels(cfg)) throw new ClientError((productCode ? '初筛编码 ' + productCode + ' 在库中不存在。' : '') + '请管理员启用模型步骤并配置对应供应商 Key 后重试，或手动录入；尚未上传原图或调用大模型', 503)
                // 原图按需直传云存储，不随免费初筛上传，也不受云函数 base64 请求大小限制。
                archivedImages = await readArchivedImages(db, auth.uid, originalHashes, recognitionDeadline)
                if (!archivedImages) {
                    const lease = await acquireRecognition(db, 'upload:' + recognitionKey, 0, '相同原图', 600000)
                    uploadLeaseKey = 'upload:' + recognitionKey; uploadLeaseOwner = lease.owner
                    retainUploadLease = true
                    const source = await ensureSource(db, auth.uid, originalHashes)
                    return ok({ needsOriginalImages: true, archiveOriginals: true, sourceDocumentId: source._id, originalUploadPrefix: originalUploadPrefix(auth.uid, uploadLeaseOwner), uploadKey: uploadLeaseKey, uploadOwner: uploadLeaseOwner, productCode, modelUsed: false })
                }
            }
            if (!text && !archivedImages && uploadLeaseKey !== 'upload:' + recognitionKey) throw new ClientError('识别配置已变化，请重新识别；尚未调用大模型', 409)
            // 已知编码查库不存在，或用户主动选择未知编码的大模型识别，才进入模型阶段。
            const acquired = await acquireRecognition(db, recognitionKey, reuseMinutes)
            if (acquired.cached) return await publish(await finishModelResult(acquired.cached, productCode, confirmedCode, expectedCode, true, purpose))
            recognitionOwner = acquired.owner
            const modelImages = text ? [] : archivedImages || await loadOriginalImages(originalIdsToCleanup, recognitionDeadline, originalHashes)
            // 等待并发请求/取得租约后再查一次，避免这期间已建档仍继续付费。
            archive = await fetchArchive(productCode)
            if (archive && !modelFallback) {
                await failRecognition(db, recognitionKey, recognitionOwner)
                recognitionOwner = ''
                return await publish(archiveResult(screened, archive, purpose), modelImages)
            }
            if (!hasReadyModels(cfg, text ? 'text' : 'image')) throw new ClientError('请管理员启用模型步骤并配置对应供应商 Key，尚未调用大模型', 503)
            // 图片缓存仍独立；同一新产品的不同照片/用途共享模型处理租约，防止并发付费。
            if (productCode) {
                productRecognitionKey = 'product-processing:' + productCode
                const productLease = await acquireRecognition(db, productRecognitionKey, 0, '产品 ' + productCode)
                productRecognitionOwner = productLease.owner
            }
            archive = await fetchArchive(productCode)
            if (archive && !modelFallback) {
                await failRecognition(db, recognitionKey, recognitionOwner)
                recognitionOwner = ''
                if (productRecognitionOwner) await completeRecognition(db, productRecognitionKey, productRecognitionOwner, {}, 0)
                productRecognitionOwner = ''
                return await publish(archiveResult(screened, archive, purpose), modelImages)
            }
            const parsed = await recognizeModels({ config: cfg, images: modelImages, text, purpose, uid: auth.uid, deadline: recognitionDeadline, callModel: callSF })
            const out = purpose === 'bom' ? validateBomFields(parsed) : validateFields(parsed)
            await completeRecognition(db, recognitionKey, recognitionOwner, out, retainedMinutes)
            recognitionOwner = ''
            if (productRecognitionOwner) await completeRecognition(db, productRecognitionKey, productRecognitionOwner, {}, 0)
            productRecognitionOwner = ''
            return await publish(await finishModelResult(out, productCode, confirmedCode, expectedCode, false, purpose), modelImages)
        }

        // 保存：确认后的字段落库（_id = order:<订单号>，幂等覆盖）
        if (event.action === 'save') {
            return ok(await saveOrder(db, event.record, auth.uid, event.expectedVersion, (auth.role || []).includes('admin')))
        }

        return fail(400, '未知 action: ' + event.action)
    } catch (e) {
        if (recognitionOwner) {
            try { await failRecognition(db, recognitionKey, recognitionOwner) }
            catch (error) { console.warn('[doc-ocr] 无法释放识别请求，请等待处理状态过期') }
        }
        if (productRecognitionOwner) {
            try { await failRecognition(db, productRecognitionKey, productRecognitionOwner) }
            catch (error) { console.warn('[doc-ocr] 无法释放产品识别请求，请等待处理状态过期') }
        }
        if (e instanceof ClientError || e.name === 'OcrConfigError') return fail(e.code || 500, e.message)
        console.error('[doc-ocr] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    } finally {
        if (originalIdsToCleanup.length) {
            try { await cleanupOriginalImages(originalIdsToCleanup) }
            catch (error) { console.warn('[doc-ocr] 临时原图清理失败，请稍后清理云存储') }
        }
        if (uploadLeaseOwner && !retainUploadLease) {
            try { await completeRecognition(db, uploadLeaseKey, uploadLeaseOwner, {}, 0) }
            catch (error) { console.warn('[doc-ocr] 原图上传状态清理失败，请等待过期') }
        }
    }
}
