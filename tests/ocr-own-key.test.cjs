// 用户自带识别 Key + 默认双通模型链（node 运行：node tests/ocr-own-key.test.cjs）
// 覆盖：供应商类型校验 / Key 归一化（星号视为未设置）/ 按类型替换且不改原配置 /
//       类型不匹配时不标记 ownKey / 默认模型链为 DeepSeek 官方 Flash + 硅基流动 DeepSeek Flash

const assert = require('node:assert')
const path = require('node:path')

const ownKey = require(path.join(__dirname, '../uniCloud-alipay/cloudfunctions/doc-ocr/own-key.js'))
const ocrConfig = require(path.join(__dirname, '../uniCloud-alipay/cloudfunctions/common/ocr-config/index.js'))

let passed = 0
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name) }

test('供应商类型只接受 deepseek / siliconflow', () => {
    assert.equal(ownKey.ownProviderType('deepseek'), 'deepseek')
    assert.equal(ownKey.ownProviderType(' siliconflow '), 'siliconflow')
    assert.equal(ownKey.ownProviderType('openai'), '')
    assert.equal(ownKey.ownProviderType(''), '')
    assert.equal(ownKey.ownProviderType(null), '')
})

test('归一化：空 Key 与星号脱敏值都视为未设置', () => {
    assert.equal(ownKey.normalizeOwnKey(null), null)
    assert.equal(ownKey.normalizeOwnKey({}), null)
    assert.equal(ownKey.normalizeOwnKey({ apiKey: '' }), null)
    assert.equal(ownKey.normalizeOwnKey({ apiKey: '****' }), null)
    assert.equal(ownKey.normalizeOwnKey({ apiKey: '••••••' }), null)
})

test('归一化：保留供应商，未知供应商回落到 deepseek', () => {
    assert.deepEqual(ownKey.normalizeOwnKey({ providerType: 'siliconflow', apiKey: ' sk-sf ' }), { providerType: 'siliconflow', apiKey: 'sk-sf' })
    assert.deepEqual(ownKey.normalizeOwnKey({ providerType: 'openai', apiKey: 'sk-x' }), { providerType: 'deepseek', apiKey: 'sk-x' })
})

const baseConfig = () => ({
    providers: [
        { id: 'deepseek', type: 'deepseek', apiKey: 'builtin-ds', enabled: true },
        { id: 'siliconflow', type: 'siliconflow', apiKey: '', enabled: false }
    ],
    modelChain: [
        { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true }
    ]
})

test('自带 Key 只替换同类型供应商，并标记 ownKey（免内置额度）', () => {
    const config = baseConfig()
    const next = ownKey.applyUserKey(config, { providerType: 'siliconflow', apiKey: 'user-sf' })
    assert.equal(next.ownKey, true)
    assert.equal(next.providers.find(p => p.type === 'siliconflow').apiKey, 'user-sf')
    assert.equal(next.providers.find(p => p.type === 'siliconflow').enabled, true)
    assert.equal(next.providers.find(p => p.type === 'deepseek').apiKey, 'builtin-ds', '不得覆盖其他供应商')
    assert.equal(config.providers.find(p => p.type === 'siliconflow').apiKey, '', '不得修改传入的原配置')
    assert.equal(config.ownKey, undefined)
})

test('供应商类型不在配置中时原样返回且不标记 ownKey', () => {
    const config = { providers: [{ id: 'deepseek', type: 'deepseek', apiKey: 'k', enabled: true }], modelChain: [] }
    const next = ownKey.applyUserKey(config, { providerType: 'siliconflow', apiKey: 'user-sf' })
    assert.equal(next, config)
    assert.equal(next.ownKey, undefined)
})

test('无自带 Key 时配置不变', () => {
    const config = baseConfig()
    assert.equal(ownKey.applyUserKey(config, null), config)
})

test('默认模型链：DeepSeek 官方 Flash 主 + 硅基流动 DeepSeek Flash 备，预算 2 次', () => {
    const eff = ocrConfig.effectiveConfig({
        apiUrl: 'https://api.deepseek.com/chat/completions',
        apiKey: 'k', model: 'deepseek-flash', textModel: 'deepseek-flash'
    }, {})
    assert.equal(eff.modelChain.length, 2)
    assert.deepEqual(eff.modelChain[0], { id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true })
    assert.deepEqual(eff.modelChain[1], { id: 'fallback', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', textModel: 'deepseek-ai/DeepSeek-V4.1-Flash', enabled: true })
    assert.equal(eff.maxModelCalls, 2, '两个步骤需要各自的请求预算')
    assert.deepEqual(eff.providers.map(p => p.type), ['ocrspace', 'deepseek', 'siliconflow'])
})

test('已存在的单步链在生效配置中自动补齐双通（不写库）', () => {
    const stableConfig = {
        providers: [
            { id: 'ocrspace', type: 'ocrspace', apiUrl: 'https://api.ocr.space/parse/image', enabled: true, apiKey: 'test-key' },
            { id: 'deepseek', type: 'deepseek', apiUrl: 'https://api.deepseek.com/chat/completions', enabled: true, apiKey: 'k' },
            { id: 'siliconflow', type: 'siliconflow', apiUrl: 'https://api.siliconflow.cn/v1/chat/completions', enabled: true, apiKey: '' }
        ],
        modelChain: [{ id: 'primary', providerId: 'deepseek', model: 'deepseek-flash', textModel: 'deepseek-flash', enabled: true }],
        maxModelCalls: 1,
        screenEngines: [2]
    }
    const eff = ocrConfig.effectiveConfig(stableConfig, {})
    assert.equal(eff.modelChain.length, 2)
    assert.equal(eff.modelChain[1].providerId, 'siliconflow')
    assert.equal(eff.modelChain[1].model, 'deepseek-ai/DeepSeek-V4.1-Flash')
    assert.equal(eff.maxModelCalls, 2)
    assert.equal(stableConfig.modelChain.length, 1, '不得修改数据库中的原配置')
})

console.log('')
console.log('用户自带 Key 与默认模型链：' + passed + ' passed, 0 failed')
