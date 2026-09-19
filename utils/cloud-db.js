// 云端数据库读取/写入（uniCloud）—— App + 微信小程序通用
// 前提：已上传 batch_buckets.schema.json 并部署云函数 batch-buckets
//
// 数据模型：单批号单文档，_id 固定为 "batch:<批号>"，字段
//   { _id, batchNo, buckets:{A..J:Number}, updatedAt, sourceFetchedAt?, checksum? }
// 读与写都走云函数 batch-buckets（schema 客户端权限全 false），避免未登录直读。
//
// 无独立同步桥：由「连公司 WiFi 的手机」手动从帆软获取后，在 fetchFromFr 里调用
// upsertBatchBuckets 写入云端；小程序再通过 fetchBatchBucketsFromCloud 读取。

import { getToken } from './auth.js'

const FN = 'batch-buckets'
const BUCKET_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

// 统一调用云函数：自动附带 uniIdToken，解析 {code, message, data}，返回 data
async function callFn(action, payload = {}) {
    const res = await uniCloud.callFunction({
        name: FN,
        data: Object.assign({ action, uniIdToken: getToken() }, payload)
    })
    const r = res && res.result
    if (!r || typeof r.code === 'undefined') {
        throw new Error('云端返回异常')
    }
    if (r.code === 401) {
        uni.reLaunch({ url: '/pages/login/login' })
        throw new Error(r.message || '登录失效，请重新登录')
    }
    if (r.code !== 0) {
        throw new Error(r.message || '云端操作失败')
    }
    return r.data
}

// 按批号取每桶件数，返回 {A:n, ..., J:n}
export async function fetchBatchBucketsFromCloud(batchNo) {
    const doc = await callFn('get', { batchNo: String(batchNo) })
    if (!doc) throw new Error('云端无该批号数据（请先由连公司 WiFi 的手机从帆软获取并写入）')
    const buckets = doc.buckets || {}
    const out = {}
    BUCKET_KEYS.forEach(k => { out[k] = Number(buckets[k] || 0) })
    return out
}

// 写入/更新某批号分桶数据（幂等：同批号始终写同一 _id）
export async function upsertBatchBuckets(batchNo, buckets, meta = {}) {
    return callFn('upsert', {
        batchNo: String(batchNo),
        buckets,
        sourceFetchedAt: meta.sourceFetchedAt || null,
        checksum: meta.checksum || null
    })
}
