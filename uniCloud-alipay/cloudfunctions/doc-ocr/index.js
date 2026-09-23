'use strict'

// 云函数：doc-ocr —— 包装指令单识别与存储
//   action = 'recognize'：图片 base64 → 硅基流动视觉模型 → 结构化 7 字段（需登录）
//   action = 'save'     ：确认后的字段写入 production_orders（_id = order:<订单号>，需登录）
// 环境变量（云函数控制台配置）：
//   SF_API_KEY  硅基流动 API Key（必填）
//   SF_MODEL    模型名（可选，默认 Qwen/Qwen3-VL-8B-Instruct；可换 Qwen/Qwen3-VL-32B-Instruct）

const { checkAuth, ok, fail, ClientError } = require('mes-common')

const COLL = 'production_orders'
const SF_API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const DEFAULT_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'   // 图片模式（视觉模型）
const DEFAULT_TEXT_MODEL = 'deepseek-ai/DeepSeek-V3.2' // 文本模式（调度快，Qwen3.5-9B 赠券期排队易超 60s）

const SYSTEM_PROMPT = `你是工厂包装指令单的录入员。根据图片内容提取字段，只输出一个 JSON 对象，不要输出任何其它文字、不要用 markdown 代码块。
字段与规则：
- orderNo: 订单号/订单编号（纯数字）
- batchNo: 生产批号（11 位字母数字，如 APDE26X1007）
- productCode: 产品编码（10 位数字）
- productName: 产品名称
- packSpec: 包装规格（如 "4瓶/箱"、"6罐/箱"）
- plannedQty: 计划产量（件，即箱数，数值；若单据只给总瓶数，按 总瓶数÷每箱数 计算箱数）
- sampleCount: 取样数量（成品+精密+菌检+留样 等各项相加的总和，必须是数字；取样行文字看不清或行被裁切时，置空字符串并把 sampleCount 加入 uncertain，绝不要猜测或只取其中一项）
- materials: 「包装材料清单」表格的每一行，数组对象，字段：
  - seq: 序号（数字）
  - materialCode: 物料编号（**纯数字**，形如 1314001003；图片上若带连字符或后缀，只取数字部分，如 "1314001003-1" 记作 "1314001003"）
  - materialName: 物料名称
  - spec: 规格型号（没有则空字符串）
  - materialVersion: 版本号（没有则 "N/A"）
  - unit: 计量单位（千克/只/卷/张/罐/瓶 等，必填；看不清则跳过该行，不要编造单位）
  物料行看不清或表格被裁切时，能提取几行就几行，漏行时在 uncertain 里加入 "materials"；没有物料表格时 materials 为空数组
- uncertain: 不确定/识别不清的字段名数组，没有则为空数组
提取不到或不确定的字段填空字符串。输出示例：
{"orderNo":"559288","batchNo":"APDE26X1007","productCode":"1306008058","productName":"FoYes分离乳清蛋白粉（锡兰红茶味）","packSpec":"4瓶/箱","plannedQty":250,"sampleCount":17,"materials":[{"seq":1,"materialCode":"1314001003","materialName":"FoYes分离乳清蛋白粉（锡兰红茶味）-混合","spec":"APDE","materialVersion":"N/A","unit":"千克"}],"uncertain":[]}`

let db = null
function getDb() {
    if (!db) db = uniCloud.database()
    return db
}

function getApiKey() {
    const k = process.env.SF_API_KEY || ''
    if (!k) throw new ClientError('服务端未配置环境变量 SF_API_KEY')
    return k
}

// 调硅基流动（带一次重试）：messages 由调用方构造，model 可指定
async function callSF(messages, model) {
    const body = {
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await uniCloud.httpclient.request(SF_API_URL, {
            method: 'POST',
            contentType: 'json',
            dataType: 'json',
            timeout: 50000,
            headers: { Authorization: 'Bearer ' + getApiKey() },
            data: body
        })
        const data = res && res.data
        // 支付宝云 httpclient 的 statusCode 不一定可靠，直接按响应内容判定成功与否
        if (!data || !data.choices || !data.choices[0]) {
            const code = res && res.statusCode
            const msg = (data && (data.message || JSON.stringify(data))) || ('HTTP ' + code)
            if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
            throw new ClientError('识别服务调用失败: ' + msg)
        }
        const content = data.choices[0].message && data.choices[0].message.content
        try {
            return JSON.parse(String(content).trim())
        } catch (e) {
            if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
            throw new ClientError('模型返回无法解析为 JSON')
        }
    }
}

// 服务端轻校验：批号 11 位字母数字；产品编码 10 位数字；订单号纯数字
function validateFields(f) {
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

exports.main = async (event) => {
    event = event || {}
    const db = getDb()
    try {
        const auth = await checkAuth(db, event.uniIdToken)
        if (auth.errCode) return fail(auth.errCode, auth.message)

        // 识别：图片 base64（小程序）或本地 OCR 文本（App）→ 结构化字段
        if (event.action === 'recognize') {
            const text = String(event.text || '').trim()
            const imageBase64 = String(event.imageBase64 || '')
            if (text) {
                const r = await callSF([
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: '以下是包装指令单的 OCR 识别文本（顺序可能错乱、可能有错字漏字），请按规则提取字段：\n\n' + text.slice(0, 6000) }
                ], process.env.SF_TEXT_MODEL || DEFAULT_TEXT_MODEL)
                return ok(validateFields(r || {}))
            }
            if (!/^data:image\/[a-z]+;base64,/.test(imageBase64)) {
                return fail(400, '缺少图片数据或 OCR 文本')
            }
            const r = await callSF([
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: imageBase64 } },
                        { type: 'text', text: '请提取这张包装指令单的字段。' }
                    ]
                }
            ], process.env.SF_MODEL || DEFAULT_MODEL)
            return ok(validateFields(r || {}))
        }

        // 保存：确认后的字段落库（_id = order:<订单号>，幂等覆盖）
        if (event.action === 'save') {
            const f = event.record || {}
            const orderNo = String(f.orderNo || '').trim()
            if (!/^\d{4,12}$/.test(orderNo)) return fail(400, '订单号非法')
            const doc = {
                orderNo,
                batchNo: String(f.batchNo || '').trim(),
                productCode: String(f.productCode || '').trim(),
                productName: String(f.productName || '').trim(),
                packSpec: String(f.packSpec || '').trim(),
                plannedQty: Number(f.plannedQty) || 0,
                sampleCount: String(f.sampleCount == null ? '' : f.sampleCount).trim(),
                materials: Array.isArray(f.materials) ? f.materials : [],
                uncertain: Array.isArray(f.uncertain) ? f.uncertain : [],
                savedBy: auth.uid,
                savedAt: Date.now()
            }
            await db.collection(COLL).doc('order:' + orderNo).set(doc)
            return ok({ _id: 'order:' + orderNo })
        }

        return fail(400, '未知 action: ' + action)
    } catch (e) {
        if (e instanceof ClientError) return fail(500, e.message)
        console.error('[doc-ocr] 运行异常:', e && (e.stack || e.message || e))
        return fail(500, '服务内部错误，请稍后重试')
    }
}
