// 包装指令单批量识别脚本（硅基流动视觉模型，图片 → 结构化 JSON → CSV）
//
// 用法：
//   SF_API_KEY=sk-xxx node scripts/order-sheet-ocr.mjs 图1.jpg 图2.jpg
//   SF_API_KEY=sk-xxx node scripts/order-sheet-ocr.mjs --dir ./photos --out ./out.csv
// 环境变量：
//   SF_API_KEY  硅基流动 API Key（必填）
//   SF_MODEL    模型名，默认 Qwen/Qwen3-VL-8B-Instruct（硅基流动赠券覆盖；不准则换 Qwen/Qwen3-VL-32B-Instruct）
//   SF_API_URL  接口地址，默认 https://api.siliconflow.cn/v1/chat/completions

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

// 预处理：sips 缩放长边到 1600px + 按 EXIF 转正（macOS 自带，免费）
function preprocess(file) {
    const tmp = path.join(os.tmpdir(), 'ocr-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg')
    try {
        execFileSync('sips', [
            '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
            '--resampleHeightWidthMax', '1024',
            file, '--out', tmp
        ], { stdio: 'pipe' })
        return tmp
    } catch (e) {
        return file // sips 失败则退回原图
    }
}

const API_URL = process.env.SF_API_URL || 'https://api.siliconflow.cn/v1/chat/completions'
const MODEL = process.env.SF_MODEL || 'Qwen/Qwen3-VL-8B-Instruct'
const API_KEY = process.env.SF_API_KEY || ''

const SYSTEM_PROMPT = `你是工厂包装指令单的录入员。根据图片内容提取字段，只输出一个 JSON 对象，不要输出任何其它文字、不要用 markdown 代码块。
字段与规则：
- orderNo: 订单号/订单编号（纯数字）
- batchNo: 生产批号（11 位字母数字，如 APDE26X1007）
- productCode: 产品编码（10 位数字）
- productName: 产品名称
- packSpec: 包装规格（如 "4瓶/箱"、"6罐/箱"）
- plannedQty: 计划产量（件，即箱数，数值；若单据只给总瓶数，按 总瓶数÷每箱数 计算箱数）
- sampleCount: 取样数量（成品+精密+菌检+留样合计；若单据写"每个追溯码留样1罐"这类不确定数量，取能确定的合计并在 uncertain 中标注）
- uncertain: 不确定/识别不清的字段名数组，没有则为空数组
提取不到或不确定的字段填空字符串。输出示例：
{"orderNo":"559288","batchNo":"APDE26X1007","productCode":"1306008058","productName":"FoYes分离乳清蛋白粉（锡兰红茶味）","packSpec":"4瓶/箱","plannedQty":250,"sampleCount":17,"uncertain":[]}`

function toDataUrl(file) {
    const buf = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase().replace('.', '') || 'jpg'
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
}

async function recognize(file) {
    const body = {
        model: MODEL,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: toDataUrl(file) } },
                    { type: 'text', text: '请提取这张包装指令单的字段。' }
                ]
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
    }
    // 失败重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
            body: JSON.stringify(body)
        })
        const data = await res.json()
        if (!res.ok) {
            const msg = (data && (data.message || JSON.stringify(data))) || `HTTP ${res.status}`
            if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
            throw new Error(msg)
        }
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        try {
            return JSON.parse(String(content).trim())
        } catch (e) {
            if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
            return { error: 'JSON 解析失败', raw: String(content).slice(0, 300) }
        }
    }
}

function csvEscape(v) {
    const s = String(v == null ? '' : v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

async function main() {
    const args = process.argv.slice(2)
    let files = []
    let outFile = './order-sheets.csv'
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dir') { files = fs.readdirSync(args[++i]).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => path.join(args[i], f)) }
        else if (args[i] === '--out') { outFile = args[++i] }
        else files.push(args[i])
    }
    if (!API_KEY) { console.error('缺少 SF_API_KEY 环境变量'); process.exit(1) }
    if (!files.length) { console.error('未指定图片（传文件路径或 --dir 目录）'); process.exit(1) }

    const header = ['文件名', '订单号', '批号', '产品编码', '产品名称', '包装规格', '计划产量(件)', '取样数', '不确定项']
    const rows = []
    for (const f of files) {
        process.stdout.write(`识别中: ${path.basename(f)} ... `)
        try {
            const r = await recognize(preprocess(f))
            rows.push([path.basename(f), r.orderNo || '', r.batchNo || '', r.productCode || '', r.productName || '', r.packSpec || '', r.plannedQty ?? '', r.sampleCount ?? '', (r.uncertain || []).join('、')])
            console.log('OK')
        } catch (e) {
            rows.push([path.basename(f), '', '', '', '', '', '', '', '失败: ' + (e.message || e)])
            console.log('FAIL: ' + (e.message || e))
        }
    }
    const csv = [header.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
    fs.writeFileSync(outFile, '\ufeff' + csv, 'utf8') // BOM 让 Excel 正确识别中文
    console.log(`\n完成 ${rows.length} 张，结果已写入 ${outFile}`)
}

main().catch(e => { console.error(e); process.exit(1) })
