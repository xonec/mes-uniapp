// product-materials 云函数单元测试（node 运行：node tests/product-materials.test.cjs）
// 覆盖：upsert 归一化与幂等 / get / list（隐藏停用+materialCount）/ 鉴权 / 入参校验 /
//       真实指令单（559290 FoYes 雪顶蜜瓜味，7 行物料）整单往返
//
// 做法：用一个「内存版 uniCloud.database()」替身 + 把裸模块名 mes-common 指到真实公共模块。

const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---- 把云函数里的 require('mes-common') 指到真实公共模块 ----
const MES_COMMON = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/mes-common/index.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
    if (request === 'mes-common') return MES_COMMON
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

const fn = require('../uniCloud-alipay/cloudfunctions/product-materials/index.js')

// ================= 测试小框架 =================
let passed = 0, failed = 0
async function test(name, f) {
    try { await f(); passed++; console.log('  ✓ ' + name) }
    catch (e) { failed++; console.error('  ✗ ' + name); console.error('    ' + (e && e.message || e)) }
}
function reset() {
    Object.keys(store).forEach(k => delete store[k])
    // checkAuth 会回查用户表 status / pwdVersion
    ensure('uni-id-users').set('u1', { _id: 'u1', status: 1, pwdVersion: 1, role: ['user'] })
}
const tokenFor = (uid) => common.createToken({ uid, role: ['user'], pv: 1 }, 'test-secret').token
const T = () => tokenFor('u1')

// 与真实指令单 559290（FoYes 雪顶蜜瓜味 APDD26X1006）同口径的一份档案
const recFoyes = (over = {}) => Object.assign({
    productCode: '1306008056',
    productName: 'FoYes分离乳清蛋白粉（雪顶蜜瓜味）',
    packSpec: 'APDD-FoYes-1.8kg/瓶*4瓶/箱',
    sourceOrderNo: '559290',
    source: 'photo',
    materials: [
        { seq: 1, materialCode: '1314001002-1', materialName: 'FoYes分离乳清蛋白粉（雪顶蜜瓜味）-混合', spec: 'APDD', materialVersion: 'N/A', unit: '千克' },
        { seq: 2, materialCode: '3100004832', materialName: '标签-KL25286-AP91', spec: '4磅-雪顶蜜瓜味-585*174mm-亮银BOPP，工艺：4色UV印刷+1色金属色+哑油，丝网印刷+可变二维码', materialVersion: '01', unit: '只' },
        { seq: 3, materialCode: '3209000229', materialName: '80cc勺子-独立包装（千帆）', spec: '80cc 高透勺', materialVersion: 'N/A', unit: '只' },
        { seq: 4, materialCode: '3302001142', materialName: '空白纸箱', spec: '405*405*288mm-A7K/C-印刷标志-倒角', materialVersion: 'N/A', unit: '只' },
        { seq: 5, materialCode: '3309000090', materialName: '透明胶带', spec: '6cm*50m', materialVersion: 'N/A', unit: '卷' },
        { seq: 6, materialCode: '3503000050', materialName: '120mm电镀银色盖-泉金（客供）', spec: 'PET热封发泡透气垫片（单耳）-FoYes定制LOGO垫片-客供', materialVersion: 'N/A', unit: '只' },
        { seq: 7, materialCode: '3504000080', materialName: '1.85gal 紫色PET 瓶-顺枫(客供）', spec: '', materialVersion: 'N/A', unit: '只' }
    ]
}, over)

const upsert = (record, uid = 'u1') => fn.main({ action: 'upsert', uniIdToken: tokenFor(uid), record })

;(async () => {
    console.log('\nproduct-materials 云函数测试')

    await test('upsert → 落库 _id = mat:<编码>，返回 materialCount', async () => {
        reset()
        const r = await upsert(recFoyes())
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data._id, 'mat:1306008056')
        assert.strictEqual(r.data.materialCount, 7)
        const doc = ensure('product_materials').get('mat:1306008056')
        assert.strictEqual(doc.productName, 'FoYes分离乳清蛋白粉（雪顶蜜瓜味）')
        assert.strictEqual(doc.sourceOrderNo, '559290')
        assert.strictEqual(doc.source, 'photo')
        assert.strictEqual(doc.enabled, true)
        assert.ok(doc.updatedAt > 0)
        assert.strictEqual(doc.updatedBy, 'u1')
    })

    await test('真实指令单整单往返：7 行物料字段逐行一致', async () => {
        reset()
        await upsert(recFoyes())
        const r = await fn.main({ action: 'get', uniIdToken: T(), productCode: '1306008056' })
        assert.strictEqual(r.code, 0)
        assert.strictEqual(r.data.packSpec, 'APDD-FoYes-1.8kg/瓶*4瓶/箱')
        assert.deepStrictEqual(
            r.data.materials.map(m => [m.seq, m.materialCode, m.unit]),
            [[1, '1314001002-1', '千克'], [2, '3100004832', '只'], [3, '3209000229', '只'], [4, '3302001142', '只'], [5, '3309000090', '卷'], [6, '3503000050', '只'], [7, '3504000080', '只']]
        )
        assert.strictEqual(r.data.materials[1].materialVersion, '01')
        assert.strictEqual(r.data.materials[4].materialName, '透明胶带')
    })

    await test('upsert 归一化：materialVersion 兜底 N/A、seq 按行号补、编码去空格', async () => {
        reset()
        await upsert(recFoyes({
            productCode: '  1306008056  ',
            materials: [
                { materialCode: '3100004832', unit: '只' },          // 无 seq / 无版本
                { materialCode: '3309000090', unit: '卷', materialVersion: '' }  // 空版本 → N/A
            ]
        }))
        const doc = ensure('product_materials').get('mat:1306008056')
        assert.strictEqual(doc.productCode, '1306008056')
        assert.deepStrictEqual(doc.materials.map(m => m.seq), [1, 2])
        assert.strictEqual(doc.materials[0].materialVersion, 'N/A')
        assert.strictEqual(doc.materials[1].materialVersion, 'N/A')
    })

    await test('upsert 幂等：同产品编码二次写为覆盖更新，不产生第二份文档', async () => {
        reset()
        await upsert(recFoyes())
        await upsert(recFoyes({ productName: 'FoYes（改）', sourceOrderNo: '559291' }))
        assert.strictEqual(ensure('product_materials').size, 1)
        const doc = ensure('product_materials').get('mat:1306008056')
        assert.strictEqual(doc.productName, 'FoYes（改）')
        assert.strictEqual(doc.sourceOrderNo, '559291')
    })

    await test('get → 不存在返回 null', async () => {
        reset()
        const miss = await fn.main({ action: 'get', uniIdToken: T(), productCode: '9999999999' })
        assert.strictEqual(miss.code, 0)
        assert.strictEqual(miss.data, null)
    })

    await test('list → 只列启用项、带 materialCount、不含 materials', async () => {
        reset()
        await upsert(recFoyes())
        await upsert(recFoyes({ productCode: '1306005276', productName: 'SWISSE® 乳清蛋白粉', enabled: false }))
        const all = await fn.main({ action: 'list', uniIdToken: T() })
        assert.strictEqual(all.code, 0)
        assert.deepStrictEqual(all.data.map(x => x.productCode), ['1306008056'])
        assert.strictEqual(all.data[0].materials, undefined)
        assert.strictEqual(all.data[0].materialCount, 7)
        assert.strictEqual(all.data[0].sourceOrderNo, '559290')
    })

    await test('鉴权：未带 token / 坏 token → 401，且不落库', async () => {
        reset()
        const noTok = await fn.main({ action: 'get', productCode: '1306008056' })
        assert.strictEqual(noTok.code, 401)
        const badTok = await upsert(recFoyes(), 'u1')
        assert.strictEqual(badTok.code, 0) // 正常 token 可写
        reset()
        const bad = await fn.main({ action: 'upsert', uniIdToken: 'garbage', record: recFoyes() })
        assert.ok(bad.code === 401 || bad.code === 403)
        assert.strictEqual(ensure('product_materials').size, 0)
    })

    await test('入参校验：空物料清单 / 缺物料编号 / 缺计量单位 / 编码含冒号 / 未知 action', async () => {
        reset()
        const empty = await upsert(recFoyes({ materials: [] }))
        assert.strictEqual(empty.code, 500)
        assert.ok(/物料清单为空/.test(empty.message))

        const noCode = await upsert(recFoyes({ materials: [{ unit: '只' }] }))
        assert.strictEqual(noCode.code, 500)
        assert.ok(/物料编号缺失/.test(noCode.message))

        const noUnit = await upsert(recFoyes({ materials: [{ materialCode: '3100004832' }] }))
        assert.strictEqual(noUnit.code, 500)
        assert.ok(/计量单位缺失/.test(noUnit.message))

        const badCode = await upsert(recFoyes({ productCode: 'mat:x' }))
        assert.strictEqual(badCode.code, 500)
        assert.ok(/冒号/.test(badCode.message))

        const unknown = await fn.main({ action: 'nope', uniIdToken: T() })
        assert.strictEqual(unknown.code, 400)
    })

    await test('异常源值 source 兜底为 manual', async () => {
        reset()
        await upsert(recFoyes({ source: 'hack' }))
        assert.strictEqual(ensure('product_materials').get('mat:1306008056').source, 'manual')
    })

    console.log('\n' + passed + ' passed, ' + failed + ' failed')
    process.exit(failed ? 1 : 0)
})()
