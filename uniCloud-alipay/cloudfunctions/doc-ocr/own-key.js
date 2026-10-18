'use strict'

// 用户自带识别模型 API Key 的纯逻辑：供应商校验、Key 归一化、按类型替换供应商 Key。
// 抽成模块便于单元测试，不依赖数据库。

const OWN_KEY_PROVIDERS = ['deepseek', 'siliconflow']

/** 只接受受支持的供应商类型，其余返回空串。 */
function ownProviderType(value) {
    const type = String(value == null ? '' : value).trim()
    return OWN_KEY_PROVIDERS.includes(type) ? type : ''
}

/**
 * 把数据库行归一化成 { providerType, apiKey }；无 Key 或 Key 非法（星号遮挡）时返回 null。
 * 星号是脱敏值，绝不能被当作真实 Key 使用。
 */
function normalizeOwnKey(row) {
    if (!row || typeof row !== 'object') return null
    const apiKey = String(row.apiKey == null ? '' : row.apiKey).trim()
    if (!apiKey || /^[*＊•●]+$/.test(apiKey)) return null
    return { providerType: ownProviderType(row.providerType) || 'deepseek', apiKey }
}

/**
 * 只替换同类型供应商的 Key，并标记 ownKey（识别时据此免内置额度计数）。
 * 供应商类型不在配置中时不改动配置，避免用户 Key 无处可用时被误标为已用自己的额度。
 */
function applyUserKey(config, userKey) {
    if (!config || !userKey) return config
    const providers = Array.isArray(config.providers) ? config.providers : []
    if (!providers.some(provider => provider.type === userKey.providerType)) return config
    return {
        ...config,
        ownKey: true,
        providers: providers.map(provider => provider.type === userKey.providerType
            ? { ...provider, apiKey: userKey.apiKey, enabled: true }
            : provider)
    }
}

module.exports = { OWN_KEY_PROVIDERS, ownProviderType, normalizeOwnKey, applyUserKey }
