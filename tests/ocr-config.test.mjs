// ocr-config 纯函数单测（ESM，node --experimental-detect-module）
import assert from 'node:assert/strict'
import {
    DEFAULT_OCR_CONFIG,
    PROVIDER_PRESETS,
    maskApiKey,
    mergeOcrConfig,
    effectiveConfig,
    presetToForm
} from '../utils/ocr-config.js'

let pass = 0
function t(name, fn) {
    try { fn(); pass++; console.log('  ✓ ' + name) }
    catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1 }
}

console.log('ocr-config:')

t('默认配置字段齐全', () => {
    assert.equal(DEFAULT_OCR_CONFIG.apiUrl, 'https://api.deepseek.com/chat/completions')
    assert.equal(DEFAULT_OCR_CONFIG.timeout, 60000)
    assert.equal(DEFAULT_OCR_CONFIG.maxAttempts, 2)
    assert.equal('economyMode' in DEFAULT_OCR_CONFIG, false)
})

t('预设含三家供应商', () => {
    assert.ok(PROVIDER_PRESETS.deepseek)
    assert.ok(PROVIDER_PRESETS.siliconflow)
    assert.ok(PROVIDER_PRESETS.selfhost)
    assert.equal(PROVIDER_PRESETS.siliconflow.apiUrl, 'https://api.siliconflow.cn/v1/chat/completions')
})

t('maskApiKey 长短密钥均为固定星号，不透露字符或长度', () => {
    for (const key of ['sk-abcdefghij1234567890XYZW', 'abc']) {
        assert.equal(maskApiKey(key), '********')
    }
})

t('maskApiKey 空串返回空', () => {
    assert.equal(maskApiKey(''), '')
    assert.equal(maskApiKey(null), '')
})

t('mergeOcrConfig 空白不覆盖原 Key', () => {
    const merged = mergeOcrConfig({ apiKey: 'old-secret-key', apiUrl: 'https://a.com' }, { apiKey: '', apiUrl: 'https://b.com' })
    assert.equal(merged.apiKey, 'old-secret-key')
    assert.equal(merged.apiUrl, 'https://b.com')
})

t('mergeOcrConfig 新 Key 覆盖', () => {
    const merged = mergeOcrConfig({ apiKey: 'old' }, { apiKey: 'new-key' })
    assert.equal(merged.apiKey, 'new-key')
})

t('mergeOcrConfig 数值字段取正数', () => {
    const merged = mergeOcrConfig({}, { timeout: 60000, maxAttempts: 5 })
    assert.equal(merged.timeout, 60000)
    assert.equal(merged.maxAttempts, 5)
})

t('mergeOcrConfig 非法数值回落默认', () => {
    const merged = mergeOcrConfig({}, { timeout: -1, maxAttempts: 'abc' })
    assert.equal(merged.timeout, DEFAULT_OCR_CONFIG.timeout)
    assert.equal(merged.maxAttempts, DEFAULT_OCR_CONFIG.maxAttempts)
})

t('effectiveConfig DB 优先于 env', () => {
    const eff = effectiveConfig({ apiUrl: 'https://db.com', apiKey: 'db-key' }, { apiUrl: 'https://env.com', apiKey: 'env-key' })
    assert.equal(eff.apiUrl, 'https://db.com')
    assert.equal(eff.apiKey, 'db-key')
})

t('effectiveConfig DB 空白回落 env 默认', () => {
    const eff = effectiveConfig({ apiUrl: '', apiKey: '' }, { apiUrl: 'https://env.com', apiKey: 'env-key' })
    assert.equal(eff.apiUrl, 'https://env.com')
    assert.equal(eff.apiKey, 'env-key')
})

t('effectiveConfig 全空回落内置默认', () => {
    const eff = effectiveConfig({}, {})
    assert.equal(eff.apiUrl, DEFAULT_OCR_CONFIG.apiUrl)
    assert.equal(eff.model, DEFAULT_OCR_CONFIG.model)
    assert.equal(eff.dailyLimit, DEFAULT_OCR_CONFIG.dailyLimit)
    assert.equal(eff.userDailyLimit, DEFAULT_OCR_CONFIG.userDailyLimit)
    assert.equal(eff.dedupMinutes, DEFAULT_OCR_CONFIG.dedupMinutes)
})

t('effectiveConfig 限额字段：DB 空白回落 env 默认', () => {
    const eff = effectiveConfig({ apiUrl: 'https://db.com' }, { dailyLimit: 500, userDailyLimit: 0, dedupMinutes: 10 })
    assert.equal(eff.dailyLimit, 500)
    assert.equal(eff.userDailyLimit, 0)
    assert.equal(eff.dedupMinutes, 10)
})

t('effectiveConfig 不再强制重试次数与去重天数（旧库残留 economyMode 被忽略）', () => {
    const eff = effectiveConfig({ apiUrl: 'https://db.com', maxAttempts: 3, dedupMinutes: 5, economyMode: true }, {})
    assert.equal(eff.maxAttempts, 3)
    assert.equal(eff.dedupMinutes, 5)
    assert.equal('economyMode' in eff, false)
})

t('mergeOcrConfig 限额：显式 0 不被旧值覆盖', () => {
    const merged = mergeOcrConfig({ dailyLimit: 200, userDailyLimit: 100 }, { dailyLimit: 0, userDailyLimit: 0 })
    assert.equal(merged.dailyLimit, 0)
    assert.equal(merged.userDailyLimit, 0)
})

t('mergeOcrConfig 限额：未传则沿用旧值', () => {
    const merged = mergeOcrConfig({ dailyLimit: 200, userDailyLimit: 100 }, {})
    assert.equal(merged.dailyLimit, 200)
    assert.equal(merged.userDailyLimit, 100)
})

t('mergeOcrConfig 限额：新值覆盖', () => {
    const merged = mergeOcrConfig({ dailyLimit: 200 }, { dailyLimit: 999 })
    assert.equal(merged.dailyLimit, 999)
})

t('presetToForm 取预设字段', () => {
    const f = presetToForm('siliconflow')
    assert.equal(f.apiUrl, PROVIDER_PRESETS.siliconflow.apiUrl)
    assert.equal(f.model, PROVIDER_PRESETS.siliconflow.model)
})

t('presetToForm 未知预设回落默认', () => {
    const f = presetToForm('nope')
    assert.equal(f.apiUrl, DEFAULT_OCR_CONFIG.apiUrl)
})

console.log(`\nocg-config: ${pass} passed`)
