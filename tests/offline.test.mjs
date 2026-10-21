// 离线产品参数轻缓存单测（node 直接跑，不依赖 uni 运行时）
import assert from 'node:assert/strict'
import {
    OFFLINE_BLOCK_TOAST,
    PRODUCT_CACHE_KEY,
    PRODUCT_CACHE_LIMIT,
    PRODUCT_CACHE_VERSION,
    normalizeProduct,
    normalizeItems,
    pruneItems,
    upsertItem,
    findItem,
    readProductCache,
    writeProductCache,
    upsertCachedProduct,
    findCachedProduct,
    formatCacheDate
} from '../utils/offline.js'

let passed = 0
let failed = 0
function test(name, fn) {
    try { fn(); passed += 1; console.log('  ✓ ' + name) } catch (error) { failed += 1; console.log('  ✗ ' + name + '\n    ' + (error && error.message)) }
}
function fakeStorage(initial) {
    const data = { ...(initial || {}) }
    return {
        getStorageSync: key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : ''),
        setStorageSync: (key, value) => { data[key] = value },
        snapshot: () => data
    }
}

console.log('offline-mode:')

test('统一置灰提示文案', () => {
    assert.equal(OFFLINE_BLOCK_TOAST, '离线模式不可用：登录后可用')
})

test('产品缓存只保留 4 个业务字段 + updatedAt，不含人员/订单字段', () => {
    const item = normalizeProduct({ code: '1306007752', name: '东方甄选蛋白粉', perCase: 30, perPallet: 20, updatedAt: 111, customerId: 'x', orderNo: 'y' }, 222)
    assert.deepEqual(Object.keys(item).sort(), ['code', 'name', 'perCase', 'perPallet', 'updatedAt'])
    assert.equal(item.updatedAt, 222)
})

test('缺字段 / 非正数 / 空编码返回 null', () => {
    assert.equal(normalizeProduct(null), null)
    assert.equal(normalizeProduct({ code: '', name: 'a', perCase: 1, perPallet: 1 }), null)
    assert.equal(normalizeProduct({ code: '1', name: 'a', perCase: 0, perPallet: 1 }), null)
    assert.equal(normalizeProduct({ code: '1', name: 'a', perCase: 1, perPallet: -3 }), null)
    assert.equal(normalizeProduct({ code: '1', name: '  ', perCase: 1, perPallet: 1 }), null)
})

test('upsert 新增/覆盖并刷新 updatedAt', () => {
    let items = upsertItem({}, { code: 'A1', name: '产品甲', perCase: 10, perPallet: 5 }, 1000)
    assert.equal(Object.keys(items).length, 1)
    items = upsertItem(items, { code: 'A1', name: '产品甲-改', perCase: 12, perPallet: 6 }, 2000)
    assert.equal(items.A1.name, '产品甲-改')
    assert.equal(items.A1.perCase, 12)
    assert.equal(items.A1.updatedAt, 2000)
})

test('上限 50 条，按 updatedAt 淘汰最旧', () => {
    let items = {}
    for (let i = 1; i <= PRODUCT_CACHE_LIMIT + 5; i++) {
        items = upsertItem(items, { code: 'P' + i, name: '产品' + i, perCase: 1, perPallet: 1 }, 1000 + i)
    }
    assert.equal(Object.keys(items).length, PRODUCT_CACHE_LIMIT)
    assert.equal(items.P1, undefined)
    assert.ok(items['P' + (PRODUCT_CACHE_LIMIT + 5)])
})

test('按编码精确查找（含 trim）', () => {
    const items = upsertItem({}, { code: '1306007752', name: '甲', perCase: 1, perPallet: 1 }, 1)
    assert.equal(findItem(items, ' 1306007752 ').name, '甲')
    assert.equal(findItem(items, '000'), null)
})

test('缓存容器损坏 / 版本不符时回退空对象', () => {
    assert.deepEqual(normalizeItems(''), {})
    assert.deepEqual(normalizeItems({ v: 2, items: { A: {} } }), {})
    assert.deepEqual(normalizeItems({ v: PRODUCT_CACHE_VERSION, items: { bad: { code: 'bad' } } }), {})
})

test('storage 往返（注入 fake uni）', () => {
    const store = fakeStorage()
    upsertCachedProduct(store, { code: 'C1', name: '丙', perCase: 4, perPallet: 2 }, 3000)
    const raw = store.snapshot()[PRODUCT_CACHE_KEY]
    assert.equal(raw.v, PRODUCT_CACHE_VERSION)
    assert.equal(findCachedProduct(store, 'C1').perCase, 4)
    assert.equal(findCachedProduct(store, 'NOPE'), null)
    // 已存数据可再次读取（模拟离线只读路径）
    assert.equal(readProductCache(store).C1.name, '丙')
})

test('写入失败不影响调用方（storage 抛错被吞掉）', () => {
    const broken = { getStorageSync: () => ({}), setStorageSync: () => { throw new Error('quota') } }
    assert.deepEqual(writeProductCache(broken, {}), {})
})

test('缓存日期格式化', () => {
    assert.equal(formatCacheDate(new Date(2026, 9, 21, 12).getTime()), '2026-10-21')
    assert.equal(formatCacheDate(0), '')
    assert.equal(formatCacheDate('x'), '')
})

console.log('offline-mode: ' + passed + ' passed, ' + failed + ' failed')
if (failed) process.exit(1)
