// product-bom 云函数单元测试（node 运行：node tests/product-bom.test.cjs）
// 覆盖：upsert 归一化与幂等 / get / list（隐藏停用+materialCount）/ matchByBatch（唯一 vs 歧义）/
//       历史字段（bottlePerCase/casePerPallet）合成 packLevels / 鉴权 / 入参校验
//
// 做法：用一个「内存版 uniCloud.database()」替身 + 把裸模块名 mes-common 指到真实公共模块。

const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---- 把云函数里的 require('mes-common') 指到真实公共模块 ----
const MES_COMMON = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')
const UNIID_STUB = path.join(__dirname, 'helpers/uni-id-common-stub.cjs')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'mes-common') return MES_COMMON
    if (request === 'uni-id-common') return UNIID_STUB
    return origResolve.call(this, request, ...args)
}

process.env.MES_TOKEN_SECRET = 'test-secret'

const common = require(MES_COMMON)

// ================= 内存版 uniCloud 数据库替身 =================
const store = {}

function clone(v) { return JSON.parse(JSON.stringify(v)) }
function matchCond(doc, cond) {
    if (!cond) return true
    return Object.keys(cond).every(k => doc[k] === cond[k])
}
function ensure(name) { if (!store[name]) store[name] = new Map(); return store[name] }

function makeQuery(name, cond) {
    const q = {
        limit(n) { q._limit = n; return q },
        field(f) { q._field = f; return q },
        async get() {
            let rows = [...ensure(name).values()].map(clone).filter(r => matchCond(r, cond))
            if (q._limit) rows = rows.slice(0, q._limit)
            return { data: rows }
        }
    }
    return q
}

function makeCollection(name) {
    const base = makeQuery(name, null)
    base.doc = (id) => ({
        async get() { const d = ensure(name).get(id); return { data: d ? [clone(d)] : [] } },
        async set(data) { ensure(name).set(id, Object.assign({}, data, { _id: id })); return { updated: 1 } },
        async update(data) {
            if (!ensure(name).has(id)) return { updated: 0 }
            ensure(name).set(id, Object.assign({}, ensure(name).get(id), data))
            return { updated: 1 }
        }
    })
    base.where = (cond) => makeQuery(name, cond)
    base.add = async (doc) => {
        const id = doc._id || ('auto_' + Math.random().toString(36).slice(2))
        if (ensure(name).has(id)) throw new Error('duplicate key error')
        ensure(name).set(id, Object.assign({}, doc, { _id: id }))
        return { id }
    }
    return base
}

global.uniCloud = { database: () => ({ collection: (name) => makeCollection(name) }) }

const fn = require('../uniCloud-alipay/cloudfunctions/product-bom/index.js')

// ================= 测试小框架 =================
let passed = 0, failed = 0
async function test(name, f) {
    try { await f(); passed++; console.log('  ✓ ' + name) }
    catch (e) { failed++; console.error('  ✗ ' + name); console.error('    ' + (e && e.message || e)) }
}
function reset() {
    Object.keys(store).forEach(k => delete store[k])
    // checkAuth 会回查用户表 status / role（uni-id 语义 status 0=正常）
    ensure('uni-id-users').set('u1', { _id: 'u1', status: 0, role: ['user'] })
}
const tokenFor = (uid) => 'tok-' + uid
const T = () => tokenFor('u1')

// 与真实单据 567299（肌酸粉 OP7F）同口径的一份 BOM
const bomCreatine = (over = {}) => Object.assign({
    productCode: '1306003790',
    productName: '肌酸粉',
    packSpec: 'OP7F-200g/瓶*36瓶/箱*64箱/托',
    batchPrefix: 'OP7F',
    innerUnit: '瓶',
    innerWeightKg: 0.2,
    packLevels: [{ key: 'case', unit: '箱', per: 36 }, { key: 'pallet', unit: '托', per: 64 }],
    source: 'photo',
    materials: [
        { seq: 1, materialCode: '1314000418-1', materialName: '肌酸粉-混合', unit: '千克', category: 'powder', basis: 'inner', qtyPerBasis: 0.2, wasteRate: 0, roundMode: 'none' },
        { seq: 2, materialCode: '3100003463', materialName: '标签-OP7F', unit: '只', category: 'label', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.02 },
        { seq: 3, materialCode: '3309000090', materialName: '透明胶带', unit: '卷', category: 'tape', basis: 'case', qtyPerBasis: 0.052, wasteRate: 0 },
        { seq: 4, materialCode: '3302000209', materialName: '大衬板', unit: '张', category: 'board', basis: 'manual', manualQty: 19 }
    ]
}, over)

const upsert = (bom, uid = 'u1') => fn.main({ action: 'upsert', uniIdToken: tokenFor(uid), bom })

;(async () => {
    console.log('\nproduct-bom 云函数测试')

    await test('upsert → 落库 _id = bom:<编码>，返回 materialCount', async () => {
        reset()
        const r = await upsert(bomCreatine())
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data._id, 'bom:1306003790')
        assert.strictEqual(r.data.materialCount, 4)
        const doc = ensure('product_bom').get('bom:1306003790')
        assert.strictEqual(doc.productName, '肌酸粉')
        assert.strictEqual(doc.enabled, true)
        assert.strictEqual(doc.source, 'photo')
        assert.ok(doc.updatedAt > 0)
        assert.strictEqual(doc.updatedBy, 'u1')
    })

    await test('upsert 归一化：roundMode 兜底 ceil、wasteRate 钳制、manual 行保留 manualQty', async () => {
        reset()
        await upsert(bomCreatine({
            materials: [
                { unit: '只', basis: 'inner', qtyPerBasis: 1, wasteRate: 0.02 },                       // 无 roundMode → ceil
                { unit: '只', basis: 'inner', qtyPerBasis: 1, wasteRate: 9 },                          // >1 → 0.99
                { unit: '只', basis: 'inner', qtyPerBasis: 1, wasteRate: -3 },                         // <0 → 0
                { unit: '张', basis: 'manual', manualQty: 17 },                                        // 人工量
                { unit: '只', basis: 'inner', qtyPerBasis: 1, roundMode: 'none' }                      // 保留 none
            ]
        }))
        const m = ensure('product_bom').get('bom:1306003790').materials
        assert.strictEqual(m[0].roundMode, 'ceil')
        assert.strictEqual(m[0].materialVersion, 'N/A')
        assert.strictEqual(m[1].wasteRate, 0.99)
        assert.strictEqual(m[2].wasteRate, 0)
        assert.strictEqual(m[3].manualQty, 17)
        assert.strictEqual(m[4].roundMode, 'none')
        // seq 缺省按行号补
        assert.deepStrictEqual(m.map(x => x.seq), [1, 2, 3, 4, 5])
    })

    await test('upsert 幂等：同产品编码二次写为覆盖更新，不产生第二份文档', async () => {
        reset()
        await upsert(bomCreatine())
        await upsert(bomCreatine({ productName: '肌酸粉（改）' }))
        assert.strictEqual(ensure('product_bom').size, 1)
        assert.strictEqual(ensure('product_bom').get('bom:1306003790').productName, '肌酸粉（改）')
    })

    await test('get → 读回整份 BOM；不存在返回 null', async () => {
        reset()
        await upsert(bomCreatine())
        const r = await fn.main({ action: 'get', uniIdToken: T(), productCode: '1306003790' })
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.materials.length, 4)
        assert.strictEqual(r.data.packLevels[0].per, 36)
        const miss = await fn.main({ action: 'get', uniIdToken: T(), productCode: '9999999999' })
        assert.strictEqual(miss.code, 0)
        assert.strictEqual(miss.data, null)
    })

    await test('list → 只列启用项、带 materialCount、不含 materials；支持 batchPrefix 过滤', async () => {
        reset()
        await upsert(bomCreatine())
        await upsert(bomCreatine({ productCode: '1306008137', batchPrefix: 'APD8', productName: 'FoYes蜜桃味' }))
        await upsert(bomCreatine({ productCode: '1306003626', batchPrefix: 'OP6K', enabled: false }))
        const all = await fn.main({ action: 'list', uniIdToken: T() })
        assert.strictEqual(all.code, 0)
        assert.deepStrictEqual(all.data.map(x => x.productCode).sort(), ['1306003790', '1306008137'])
        assert.strictEqual(all.data[0].materials, undefined)
        assert.strictEqual(all.data[0].materialCount, 4)
        const only = await fn.main({ action: 'list', uniIdToken: T(), batchPrefix: 'apd8' })
        assert.deepStrictEqual(only.data.map(x => x.productCode), ['1306008137'])
    })

    await test('matchByBatch → 唯一命中返回 bom；多份/停用/无命中分别处理', async () => {
        reset()
        await upsert(bomCreatine())
        let r = await fn.main({ action: 'matchByBatch', uniIdToken: T(), batchNo: 'OP7F26X1019' })
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.bom.productCode, '1306003790')
        assert.strictEqual(r.data.ambiguous, false)

        // 同前缀第二份 → 歧义，不随便挑
        await upsert(bomCreatine({ productCode: '1306003791' }))
        r = await fn.main({ action: 'matchByBatch', uniIdToken: T(), batchNo: 'OP7F26X1019' })
        assert.strictEqual(r.data.bom, null)
        assert.strictEqual(r.data.ambiguous, true)
        assert.strictEqual(r.data.count, 2)

        // 无命中
        r = await fn.main({ action: 'matchByBatch', uniIdToken: T(), batchNo: 'ZZZZ26X1019' })
        assert.strictEqual(r.data.bom, null)
        assert.strictEqual(r.data.count, 0)

        // 停用不参与匹配
        reset()
        await upsert(bomCreatine({ enabled: false }))
        r = await fn.main({ action: 'matchByBatch', uniIdToken: T(), batchNo: 'OP7F26X1019' })
        assert.strictEqual(r.data.count, 0)
    })

    await test('历史兼容：只给 bottlePerCase / casePerPallet 也能合成 packLevels', async () => {
        reset()
        await upsert(bomCreatine({ packLevels: undefined, bottlePerCase: 36, casePerPallet: 64 }))
        const doc = ensure('product_bom').get('bom:1306003790')
        assert.deepStrictEqual(doc.packLevels, [{ key: 'case', unit: '箱', per: 36 }, { key: 'pallet', unit: '托', per: 64 }])
        assert.strictEqual(doc.bottlePerCase, 36)
        assert.strictEqual(doc.casePerPallet, 64)
        assert.strictEqual(doc.bottleWeightKg, 0.2)   // 历史别名同步落库
    })

    await test('鉴权：未带 token / 坏 token → 401，且不落库', async () => {
        reset()
        const noTok = await fn.main({ action: 'get', productCode: '1306003790' })
        assert.strictEqual(noTok.code, 401)
        const badTok = await fn.main({ action: 'upsert', uniIdToken: 'garbage', bom: bomCreatine() })
        assert.ok(badTok.code === 401 || badTok.code === 403)
        assert.strictEqual(ensure('product_bom').size, 0)
    })

    await test('入参校验：空物料清单 / 非法 basis / 编码含冒号 / 未知 action', async () => {
        reset()
        const empty = await upsert(bomCreatine({ materials: [] }))
        assert.strictEqual(empty.code, 500)
        assert.ok(/物料清单为空/.test(empty.message))

        const badBasis = await upsert(bomCreatine({ materials: [{ unit: '只', basis: 'bottle2', qtyPerBasis: 1 }] }))
        assert.strictEqual(badBasis.code, 500)
        assert.ok(/basis 非法/.test(badBasis.message))

        const badCode = await upsert(bomCreatine({ productCode: 'bom:x' }))
        assert.strictEqual(badCode.code, 500)
        assert.ok(/冒号/.test(badCode.message))

        const unknown = await fn.main({ action: 'nope', uniIdToken: T() })
        assert.strictEqual(unknown.code, 400)
    })

    await test('batchPrefix 缺省时由批号前 4 位兜底；产品编码去空格', async () => {
        reset()
        await upsert(bomCreatine({ batchPrefix: '', batchNo: 'OP7F26X1019', productCode: '  1306003790  ' }))
        const doc = ensure('product_bom').get('bom:1306003790')
        assert.strictEqual(doc.batchPrefix, 'OP7F')
        assert.strictEqual(doc.productCode, '1306003790')
    })

    await test('异常源值 source 兜底为 manual', async () => {
        reset()
        await upsert(bomCreatine({ source: 'hack' }))
        assert.strictEqual(ensure('product_bom').get('bom:1306003790').source, 'manual')
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
