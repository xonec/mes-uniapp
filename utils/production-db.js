// 生产记录云端读写（uniCloud）—— 多端共享，读写均走云函数并登录鉴权
// 前提：已上传 production_records.schema.json 并部署云函数 production-records
//
// 数据模型：单批号单文档，_id 固定为 "rec:<批号>"，字段与本地保存的 rec 完全一致。
// 历史版本存 production_record_versions（_id = ver:<批号>:<版本号>）。
// 读与写都走云函数 production-records（schema 客户端权限全 false），避免未登录直读。

import { getToken } from './auth.js'

const FN = 'production-records'

// 统一调用云函数：自动附带 uniIdToken，处理登录失效
async function callFn(action, payload = {}) {
    const res = await uniCloud.callFunction({
        name: FN,
        data: Object.assign({ action, uniIdToken: getToken() }, payload)
    })
    const r = res && res.result
    if (r && r.code === 401) {
        uni.reLaunch({ url: '/pages/login/login' })
        throw new Error(r.message || '登录失效，请重新登录')
    }
    if (r && r.code && r.code !== 0) {
        throw new Error(r.message || '云端操作失败')
    }
    return r
}

// 保存/更新生产记录（幂等：同批号始终写同一 _id）
export async function saveProductionRecord(record) {
    const r = await callFn('upsert', { record })
    if (!r || r.ok !== true) throw new Error((r && r.message) || '云端保存失败')
    return r
}

// 读单批号生产记录，无记录返回 null
export async function fetchProductionRecord(batchNo) {
    return callFn('get', { batchNo: String(batchNo) })
}

// 列出生产记录（按 updatedAt 倒序，仅投影 batchNo，支持 skip 分页）
export async function listProductionRecords(limit = 50, skip = 0) {
    const r = await callFn('list', { limit, skip })
    return Array.isArray(r) ? r : []
}

// 列出某批号的历史版本（按 version 倒序）
export async function listRecordVersions(batchNo, limit = 50) {
    const r = await callFn('listVersions', { batchNo: String(batchNo), limit })
    return Array.isArray(r) ? r : []
}

// 一键回滚：把某批号回滚到指定历史版本
export async function rollbackProductionRecord(batchNo, version) {
    const r = await callFn('rollback', { batchNo: String(batchNo), version: Number(version) })
    if (!r || r.ok !== true) throw new Error((r && r.message) || '回滚失败')
    return r
}

// 保存草稿（按 deviceId 设备隔离，其他设备不可见）
export async function saveDraftRecord(deviceId, record) {
    const r = await callFn('saveDraft', { deviceId, record })
    if (!r || r.ok !== true) throw new Error((r && r.message) || '草稿保存失败')
    return r
}

// 读本设备草稿，返回草稿 record 或 null
export async function getDraftRecord(deviceId, batchNo) {
    try {
        const r = await callFn('getDraft', { deviceId, batchNo: String(batchNo) })
        return (r && r.record) ? r.record : null
    } catch (e) {
        return null
    }
}
