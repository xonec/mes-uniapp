// 核心计算单元测试（node 运行：node --experimental-detect-module tests/calc.test.mjs）
import assert from 'node:assert'
import { computeMaterial, computeWeightRange, BUCKET_KEYS } from '../utils/calc.js'

function emptyBuckets() {
    const b = {}
    BUCKET_KEYS.forEach(k => { b[k] = '' })
    return b
}

let passed = 0
let failed = 0
function test(name, fn) {
    try {
        fn()
        passed++
        console.log('  ✓ ' + name)
    } catch (e) {
        failed++
        console.error('  ✗ ' + name)
        console.error('    ' + (e.message || e))
    }
}

// 用例 1：基本批次（2 桶 5 件，6 瓶/件，取样 2）
test('基本批次：2 桶 5 件', () => {
    const b = emptyBuckets()
    b.A = 2; b.B = 3
    const r = computeMaterial({ buckets: b, zeroCount: '', perCase: 6, perPallet: 49, sampleCount: 2, labelExtra: '', securityExtra: '' })
    assert.strictEqual(r.bucketCount, 2)
    assert.strictEqual(r.caseCount, 5)
    assert.strictEqual(r.bottleCount, 30)          // 5*6
    assert.strictEqual(r.innerPackageIssued, 32)   // 30 + 2
    assert.strictEqual(r.totalPallets, 1)
    assert.strictEqual(r.markCount, 7)             // 5 + 0 + 2
    assert.strictEqual(r.palletRange, 'A001-A002、B001-B003')
    assert.strictEqual(r.zeroBoxInfo, '')
    assert.strictEqual(r.caseCountText, '5 件')
    assert.strictEqual(r.palletCode, '0 托 + 5 件')
    assert.deepStrictEqual(r.materialUsed, { '标签': 32, '唛头': 7, '纸箱': 5, '防伪': 32 })
})

// 用例 2：零箱
test('零箱：1 桶 2 件 + 零箱 5 瓶', () => {
    const b = emptyBuckets()
    b.A = 2
    const r = computeMaterial({ buckets: b, zeroCount: 5, perCase: 6, perPallet: 49, sampleCount: 0, labelExtra: 0, securityExtra: 0 })
    assert.strictEqual(r.caseCount, 2)
    assert.strictEqual(r.bottleCount, 17)          // 2*6 + 5
    assert.strictEqual(r.zeroBoxInfo, 'A003（5 瓶）')
    assert.strictEqual(r.caseCountText, '2 件 + 5 瓶')
    assert.strictEqual(r.palletCode, '0 托 + 2 件 + 5 瓶')
    assert.strictEqual(r.materialUsed['纸箱'], 3)   // 2 + 1（零箱）
    assert.strictEqual(r.markCount, 4)             // 2 + 1（零箱）+ 1（桶数）
})

// 用例 3：多托 + 托分页
test('多托：50 件 / 49 件每托', () => {
    const b = emptyBuckets()
    b.A = 50
    const r1 = computeMaterial({ buckets: b, zeroCount: 0, perCase: 6, perPallet: 49, sampleCount: 0, labelExtra: 0, securityExtra: 0 })
    assert.strictEqual(r1.totalPallets, 2)
    assert.strictEqual(r1.currentPallet, 1)
    assert.strictEqual(r1.palletRange, 'A001-A049')
    const r2 = computeMaterial({ buckets: b, zeroCount: 0, perCase: 6, perPallet: 49, sampleCount: 0, labelExtra: 0, securityExtra: 0, currentPallet: 2 })
    assert.strictEqual(r2.palletRange, 'A050-A050')
    assert.strictEqual(r2.palletPage, '第 2 托 / 共 2 托')
})

// 用例 4：currentPallet 越界钳制
test('currentPallet 越界被钳制到最后一托', () => {
    const b = emptyBuckets()
    b.A = 50
    const r = computeMaterial({ buckets: b, zeroCount: 0, perCase: 6, perPallet: 49, sampleCount: 0, labelExtra: 0, securityExtra: 0, currentPallet: 99 })
    assert.strictEqual(r.currentPallet, 2)
})

// 用例 5：重量范围
test('重量范围：10kg ± 半瓶重', () => {
    assert.strictEqual(computeWeightRange(1.0, 10.0), '9.500–10.500 kg')
    assert.strictEqual(computeWeightRange('', 10.0), '—')
    assert.strictEqual(computeWeightRange(1.0, ''), '—')
    assert.strictEqual(computeWeightRange(0, 0), '—')
})

// 用例 6：空批次
test('空批次', () => {
    const b = emptyBuckets()
    const r = computeMaterial({ buckets: b, zeroCount: '', perCase: '', perPallet: '', sampleCount: '', labelExtra: '', securityExtra: '' })
    assert.strictEqual(r.bucketCount, 0)
    assert.strictEqual(r.caseCount, 0)
    assert.strictEqual(r.totalPallets, 1)
    assert.strictEqual(r.palletRange, '暂无件号')
    assert.strictEqual(r.caseCountText, '0')
    assert.strictEqual(r.palletCode, '0 托')
})

// 用例 7：跨桶连续件号不跨字母合并
test('件号分段：跨桶字母不合并', () => {
    const b = emptyBuckets()
    b.A = 3; b.B = 2
    const r = computeMaterial({ buckets: b, zeroCount: 0, perCase: 6, perPallet: 49, sampleCount: 0, labelExtra: 0, securityExtra: 0 })
    assert.strictEqual(r.palletRange, 'A001-A003、B001-B002')
})

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
