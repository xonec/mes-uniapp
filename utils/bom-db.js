// 产品 BOM 云端读写（uniCloud）—— App + 微信小程序通用
// 前提：已上传 product_bom.schema.json / product_bom.index.json 并部署云函数 product-bom
//
// 数据模型：单产品单文档，_id 固定为 "bom:<产品编码>"，字段见 product_bom.schema.json。
// 读与写都走云函数 product-bom（schema 客户端权限全 false），避免未登录直读。
// 比对/换算的纯逻辑在 utils/bom.js（可在 node 下单测）。

import { callCloud } from './cloud-call.js'

const FN = 'product-bom'

// 本模块的调用入口（统一协议解析与 401 跳登录由 cloud-call 负责）
// 可选 call：P2 批 6 新页传入 vk 版 callCloud；不传时保持旧行为。
const callFn = (action, payload, call) => (call || callCloud)(FN, action, payload)

// 按产品编码读一份 BOM，无则返回 null
export async function fetchBomByCode(productCode, call) {
    return callFn('get', { productCode: String(productCode) }, call)
}

// 列出 BOM（列表项不含 materials，仅带 materialCount）
export async function listBoms(opts = {}, call) {
    const r = await callFn('list', {
        batchPrefix: opts.batchPrefix ? String(opts.batchPrefix) : '',
        limit: opts.limit || 100
    }, call)
    return Array.isArray(r) ? r : []
}

// 按批号（取前 4 位为 batchPrefix）匹配 BOM
// 返回 { bom, ambiguous, count }：命中唯一一份才给 bom；多份视为歧义（bom=null）
// 命名与 utils/bom.js 的纯函数 matchBomByBatch(boms, batchNo) 区分：本函数直接走云端。
export async function matchBomByBatchFromCloud(batchNo, call) {
    const r = await callFn('matchByBatch', { batchNo: String(batchNo || '') }, call)
    return r || { bom: null, ambiguous: false, count: 0 }
}

// 幂等写入/更新一份 BOM（同产品编码始终写同一 _id）
export async function upsertBom(bom, call) {
    return callFn('upsert', { bom }, call)
}
