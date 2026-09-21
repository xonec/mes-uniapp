// 产品物料清单档案云端读写（uniCloud）—— App + 微信小程序通用
// 前提：已上传 product_materials.schema.json / product_materials.index.json 并部署云函数 product-materials
//
// 数据模型：单产品单文档，_id 固定为 "mat:<产品编码>"，字段见 product_materials.schema.json。
// 读与写都走云函数 product-materials（schema 客户端权限全 false），避免未登录直读。

import { callCloud } from './cloud-call.js'

const FN = 'product-materials'

// 本模块的调用入口（统一协议解析与 401 跳登录由 cloud-call 负责）
const callFn = (action, payload) => callCloud(FN, action, payload)

// 按产品编码读一份物料清单，无则返回 null
export async function fetchMaterialsByCode(productCode) {
    return callFn('get', { productCode: String(productCode) })
}

// 列出物料清单（列表项不含 materials，仅带 materialCount）
export async function listProductMaterials(opts = {}) {
    const r = await callFn('list', { limit: opts.limit || 100 })
    return Array.isArray(r) ? r : []
}

// 幂等写入/更新一份物料清单（同产品编码始终写同一 _id）
export async function upsertProductMaterials(record) {
    return callFn('upsert', { record })
}
