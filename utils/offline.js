// 离线包材计算：统一提示文案 + 产品参数轻缓存（纯函数 + storage 适配）
//
// 缓存只存产品参数：{ code, name, perCase, perPallet, updatedAt }
// 不含订单、客户、人员、账号等任何业务敏感字段；设备级、退出登录不清（离线要用）。
// 写入时机：登录态在包材计算页「按批号查询订单」成功后 upsert；离线只读。
// 上限 50 条，按 updatedAt 淘汰最旧。
import { STORE_OFFLINE_PRODUCTS } from './storage-keys.js'

export const OFFLINE_BLOCK_TOAST = '离线模式不可用：登录后可用'
export const PRODUCT_CACHE_VERSION = 1
export const PRODUCT_CACHE_LIMIT = 50
export const PRODUCT_CACHE_KEY = STORE_OFFLINE_PRODUCTS

const positiveInt = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** 归一单条产品缓存；字段不全返回 null。 */
export function normalizeProduct(input, now) {
    if (!input || typeof input !== 'object') return null
    const code = String(input.code == null ? '' : input.code).trim()
    const name = String(input.name == null ? '' : input.name).trim()
    const perCase = positiveInt(input.perCase)
    const perPallet = positiveInt(input.perPallet)
    if (!code || !name || !perCase || !perPallet) return null
    return { code, name, perCase, perPallet, updatedAt: Number(now) || Number(input.updatedAt) || Date.now() }
}

/** 读缓存容器；损坏/版本不符时回退空对象。 */
export function normalizeItems(raw) {
    if (!raw || typeof raw !== 'object') return {}
    if (Number(raw.v) !== PRODUCT_CACHE_VERSION) return {}
    const source = raw.items && typeof raw.items === 'object' ? raw.items : {}
    const items = {}
    Object.keys(source).forEach(key => {
        const item = normalizeProduct(source[key], source[key] && source[key].updatedAt)
        if (item && item.code === key) items[key] = item
    })
    return items
}

/** 按 updatedAt 保留最近 limit 条。 */
export function pruneItems(items, limit = PRODUCT_CACHE_LIMIT) {
    const list = Object.values(items || {}).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
    const out = {}
    list.slice(0, Math.max(1, limit)).forEach(item => { out[item.code] = item })
    return out
}

/** upsert 一条产品参数（纯函数，返回新 items）。 */
export function upsertItem(items, product, now, limit = PRODUCT_CACHE_LIMIT) {
    const item = normalizeProduct(product, now)
    if (!item) return items || {}
    const next = { ...(items || {}), [item.code]: item }
    return pruneItems(next, limit)
}

/** 按产品编码精确查找。 */
export function findItem(items, code) {
    const key = String(code == null ? '' : code).trim()
    return (items && items[key]) || null
}

/** 与 uni storage 对齐的最小适配：传入 uni 或 { getStorageSync, setStorageSync }。 */
function storeOf(uniLike) {
    const api = uniLike || (typeof uni !== 'undefined' ? uni : null)
    if (!api || typeof api.getStorageSync !== 'function' || typeof api.setStorageSync !== 'function') return null
    return api
}

export function readProductCache(uniLike) {
    const api = storeOf(uniLike)
    if (!api) return {}
    try { return normalizeItems(api.getStorageSync(PRODUCT_CACHE_KEY)) } catch (e) { return {} }
}

export function writeProductCache(uniLike, items) {
    const api = storeOf(uniLike)
    if (!api) return {}
    const pruned = pruneItems(items)
    try { api.setStorageSync(PRODUCT_CACHE_KEY, { v: PRODUCT_CACHE_VERSION, items: pruned }) } catch (e) { /* 存储失败不影响计算 */ }
    return pruned
}

export function upsertCachedProduct(uniLike, product, now) {
    const items = upsertItem(readProductCache(uniLike), product, now)
    return writeProductCache(uniLike, items)
}

export function findCachedProduct(uniLike, code) {
    return findItem(readProductCache(uniLike), code)
}

/** 缓存更新日期（本地时区 YYYY-MM-DD），用于离线页提示来源。 */
export function formatCacheDate(timestamp) {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts) || ts <= 0) return ''
    const date = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
