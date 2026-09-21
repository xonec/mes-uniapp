// mixin 单元测试（node 运行：node tests/mixins.test.mjs，或 npm test 一并跑）
//
// 目的：materials.vue 抽出的 mixin 属纯前端逻辑，无法在 Node 直接 import
//      （模块里用 `@/` 别名，且 uni-app 才会解析）。这里把用到的文件复制到临时目录，
//      把 `@/utils/x.js` 与相对 `./x.js` 重写成 `.mjs`，再用动态 import 加载并驱动。
//
// 覆盖：卡片默认顺序 / 布局读写与恢复 / 折叠落库 / 非法键过滤与缺失补全 /
//      移动边界 / 历史关键字过滤 / 时间格式化

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(os.tmpdir(), 'mes-mixin-test')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

// 需要复制的源文件（含 mixin 的依赖链）
const FILES = [
    'utils/storage-keys.js',
    'utils/auth.js',
    'utils/cloud-call.js',
    'utils/production-db.js',
    'mixins/card-layout.js',
    'mixins/history.js'
]
for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
        .replace(/@\/utils\/([\w.-]+)\.js/g, (_m, n) => path.join(TMP, n + '.mjs').replace(/\\/g, '/'))
        .replace(/from '\.\/([\w.-]+)\.js'/g, "from './$1.mjs'")
    fs.writeFileSync(path.join(TMP, path.basename(f, '.js') + '.mjs'), src)
}

// ---- 最小 uni 替身（只提供 mixin 用到的能力）----
const store = {}
globalThis.uni = {
    getStorageSync: k => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: () => {},
    reLaunch: () => {},
    navigateTo: () => {},
    showModal: () => {},
    createSelectorQuery: () => ({ in: () => ({ selectAll: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }) })
}

const cardLayout = (await import(path.join(TMP, 'card-layout.mjs'))).default
const history = (await import(path.join(TMP, 'history.mjs'))).default

// 用 mixin 的 data() 造一个最小的组件实例（把方法绑到该实例上）
function ctxOf(mixin) {
    const c = Object.assign({}, mixin.data())
    Object.keys(mixin.methods || {}).forEach(k => { c[k] = mixin.methods[k].bind(c) })
    return c
}
const keys = c => c.cardList.map(x => x.key).join('>')

let passed = 0, failed = 0
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name) }
    catch (e) { failed++; console.error('  ✗ ' + name); console.error('    ' + (e.message || e)) }
}

console.log('\nmixin 测试（card-layout / history）')

// ===== card-layout =====
test('默认卡片顺序为 6 张', () => {
    const c = ctxOf(cardLayout)
    assert.strictEqual(keys(c), 'batch>buckets>prod>material>weight>pallet')
})

test('无存值时 loadCardLayout 保持默认', () => {
    delete store['mes-card-layout']
    const c = ctxOf(cardLayout)
    c.loadCardLayout()
    assert.strictEqual(keys(c), 'batch>buckets>prod>material>weight>pallet')
})

test('toggleCard 切换折叠并写入 storage', () => {
    const c = ctxOf(cardLayout)
    c.toggleCard('prod')
    assert.strictEqual(c.cardList.find(x => x.key === 'prod').collapsed, true)
    assert.deepStrictEqual(store['mes-card-layout'].collapsed, {
        batch: false, buckets: false, prod: true, material: false, weight: false, pallet: false
    })
    c.toggleCard('prod')
    assert.strictEqual(c.cardList.find(x => x.key === 'prod').collapsed, false)
})

test('loadCardLayout 恢复自定义顺序与折叠态', () => {
    store['mes-card-layout'] = {
        order: ['pallet', 'batch', 'buckets', 'prod', 'material', 'weight'],
        collapsed: { pallet: true, prod: true }
    }
    const c = ctxOf(cardLayout)
    c.loadCardLayout()
    assert.strictEqual(keys(c), 'pallet>batch>buckets>prod>material>weight')
    assert.strictEqual(c.cardList.find(x => x.key === 'pallet').collapsed, true)
    assert.strictEqual(c.cardList.find(x => x.key === 'batch').collapsed, false)
})

test('loadCardLayout 过滤非法键并补全缺失键', () => {
    store['mes-card-layout'] = { order: ['pallet', 'NOT_A_CARD'], collapsed: {} }
    const c = ctxOf(cardLayout)
    c.loadCardLayout()
    assert.strictEqual(c.cardList.length, 6, '缺失的卡片应补回')
    assert.ok(!keys(c).includes('NOT_A_CARD'), '非法键应被过滤')
    assert.strictEqual(keys(c).split('>')[0], 'pallet', '已保存的顺序应生效')
})

test('moveCard 交换相邻两位并落库', () => {
    delete store['mes-card-layout']
    const c = ctxOf(cardLayout)
    c.moveCard(0, 1)
    assert.strictEqual(keys(c).split('>')[0], 'buckets')
    assert.strictEqual(store['mes-card-layout'].order[0], 'buckets')
})

test('moveCard 越界时不变', () => {
    const c = ctxOf(cardLayout)
    const before = keys(c)
    c.moveCard(0, -1)
    c.moveCard(5, 1)
    assert.strictEqual(keys(c), before)
})

// ===== history =====
test('filteredHistory 空关键字返回全部', () => {
    const c = ctxOf(history)
    c.historyList = ['OPDG26X1001', 'OPDG26X1002']
    c.historyKeyword = ''
    assert.strictEqual(history.computed.filteredHistory.call(c).length, 2)
})

test('filteredHistory 忽略大小写并按子串过滤', () => {
    const c = ctxOf(history)
    c.historyList = ['OPDG26X1001', 'XXXX26X9999']
    c.historyKeyword = 'opdg'
    assert.deepStrictEqual(history.computed.filteredHistory.call(c), ['OPDG26X1001'])
})

test('fmtTime 格式化 ISO 时间', () => {
    const c = ctxOf(history)
    const out = c.fmtTime('2026-09-20T03:05:00.000Z')
    assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(out), '应为 MM-DD HH:mm，实际 ' + out)
})

test('fmtTime 空值返回空串、非法值原样返回', () => {
    const c = ctxOf(history)
    assert.strictEqual(c.fmtTime(''), '')
    assert.strictEqual(c.fmtTime(null), '')
    assert.strictEqual(c.fmtTime('not-a-date'), 'not-a-date')
})

test('closeHistory 同时关闭历史与版本弹层', () => {
    const c = ctxOf(history)
    c.historyShow = true
    c.versionShow = true
    c.closeHistory()
    assert.strictEqual(c.historyShow, false)
    assert.strictEqual(c.versionShow, false)
})

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
