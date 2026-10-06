<template>
    <view class="page">
        <view class="card">
            <view class="card-title">识别服务设置（管理员）</view>
            <view class="tip">切换 OCR 供应商 / 模型，无需重传云函数，保存后约 60 秒内生效。Key 仅在服务端使用，不会以明文下发。</view>
        </view>

        <view class="card" v-if="!canManage">
            <view class="noauth">当前账号无权限（需管理员角色）。</view>
        </view>

        <block v-else>
            <view class="card">
                <view class="card-title">OCR.space 产品编码初筛</view>
                <view class="tip">照片预处理后先提取产品编码：已有档案跳过大模型，新产品自动识别。当前 OCR.space Key：{{ ocrSpaceMaskedKey || '未配置' }}。留空保存保留原 Key。</view>
                <view class="field"><text class="lbl">OCR.space Key</text><input class="inp" v-model="form.ocrSpaceApiKey" password :disabled="saving || loading" placeholder="首次填入，之后留空保留" /></view>
                <view class="field"><text class="lbl">免费识别引擎</text><input class="inp" v-model="form.ocrSpaceEngine" type="number" :disabled="saving || loading" placeholder="2（推荐），也可填 1 或 3" /></view>
                <view class="tip">单图上限 1 MB。Engine 2 支持中文；Engine 3 使用表格文本，速度和额度不同。新产品自动识别需要配置大模型 Key。</view>
            </view>
            <view class="card">
                <view class="card-title">识别费用控制</view>
                <view class="field">
                    <text class="lbl">省钱模式（推荐）</text>
                    <switch :checked="form.economyMode" :disabled="saving || loading" @change="changeEconomyMode" />
                </view>
                <view class="tip">开启后，相同照片的结果至少复用 7 天，每个模型最多尝试 1 次。供应商顺序、单次总请求上限和 Prompt 模板可在管理后台「OCR 配置」编辑。已有档案跳过大模型。</view>
            </view>

            <view class="card">
                <view class="card-title">新产品识别的大模型供应商</view>
                <view class="presets">
                    <view class="preset" v-for="(p, key) in presets" :key="key"
                          :class="{ active: form.provider === key, disabled: saving || loading }" @tap="applyPreset(key)">
                        {{ p.label }}
                    </view>
                </view>
            </view>

            <view class="card">
                <view class="card-title">新产品识别的大模型连接参数</view>
                <view class="tip">已有档案无需模型额度；库中不存在的产品自动使用以下模型。请为新产品识别配置有效 Key。</view>
                <view class="field">
                    <text class="lbl">API 地址</text>
                    <input class="inp" v-model="form.apiUrl" type="text" :disabled="saving || loading" placeholder="https://..." />
                </view>
                <view class="field">
                    <text class="lbl">API Key</text>
                    <input class="inp" v-model="form.apiKey" type="text" password :disabled="saving || loading"
                           :placeholder="keySet ? ('当前已设置（' + maskedKey + '），留空则保留') : '新产品自动识别需配置大模型 Key'" />
                </view>
                <view class="field">
                    <text class="lbl">图片模型</text>
                    <input class="inp" v-model="form.model" type="text" :disabled="saving || loading" placeholder="多模态模型名" />
                </view>
                <view class="field">
                    <text class="lbl">文本模型</text>
                    <input class="inp" v-model="form.textModel" type="text" :disabled="saving || loading" placeholder="兜底模型名" />
                </view>
                <view class="field">
                    <text class="lbl">超时(ms)</text>
                    <input class="inp" v-model="form.timeout" type="number" :disabled="saving || loading" placeholder="如 35000" />
                </view>
                <view class="field">
                    <text class="lbl">最多尝试次数</text>
                    <input class="inp" v-model="form.maxAttempts" type="number" placeholder="1" :disabled="saving || loading || form.economyMode" />
                </view>
                <view class="tip">尝试次数包含首次调用；省钱模式固定为 1 次，关闭后可设置 1～3 次。</view>
            </view>

            <view class="card">
                <view class="card-title">额度与去重（防浪费）</view>
                <view class="field">
                    <text class="lbl">大模型全局每日</text>
                    <input class="inp" v-model="form.dailyLimit" type="number" :disabled="saving || loading" placeholder="0=不限，默认 200" />
                </view>
                <view class="field">
                    <text class="lbl">大模型每人每日</text>
                    <input class="inp" v-model="form.userDailyLimit" type="number" :disabled="saving || loading" placeholder="0=不限，默认 100" />
                </view>
                <view class="field">
                    <text class="lbl">结果复用(分钟)</text>
                    <input class="inp" v-model="form.dedupMinutes" type="number" placeholder="10080（7 天）" :disabled="saving || loading || form.economyMode" />
                </view>
                <view class="tip">每日上限只限制大模型请求，免费 OCR 额度由 OCR.space 管理。关闭省钱模式后可设为 0，关闭长期复用；仍保留 30 分钟的临时结果供确认编码使用，避免重复付费。</view>
            </view>

            <view class="card" v-if="loaded">
                <view class="card-title">当前生效配置</view>
                <view class="kv"><text>来源</text><text>{{ sourceText }}</text></view>
                <view class="kv"><text>省钱模式</text><text>{{ eff.economyMode ? '开启' : '关闭' }}</text></view>
                <view class="kv"><text>API 地址</text><text class="mono">{{ eff.apiUrl }}</text></view>
                <view class="kv"><text>图片模型</text><text class="mono">{{ eff.model }}</text></view>
                <view class="kv"><text>文本模型</text><text class="mono">{{ eff.textModel }}</text></view>
                <view class="kv"><text>超时 / 最多尝试</text><text>{{ eff.timeout }}ms / {{ eff.maxAttempts }}次（含首次）</text></view>
                <view class="kv"><text>大模型每日上限</text><text>{{ eff.dailyLimit }} / {{ eff.userDailyLimit }}(每用户)</text></view>
                <view class="kv"><text>去重</text><text>{{ eff.dedupMinutes }} 分钟</text></view>
                <view class="kv"><text>大模型 Key</text><text>{{ keySet ? ('已设置（' + maskedKey + '）') : '未设置' }}</text></view>
            </view>

            <button class="btn primary" :disabled="saving || loading" @tap="save">{{ saving ? '保存中…' : '保存配置' }}</button>
        </block>
    </view>
</template>

<script>
import { callCloud } from '@/utils/cloud-call.js'
import { getUser } from '@/utils/auth.js'
import { PROVIDER_PRESETS, presetToForm } from '@/utils/ocr-config.js'

export default {
    data() {
        return {
            canManage: false,
            loaded: false,
            loading: false,
            saving: false,
            presets: PROVIDER_PRESETS,
            maskedKey: '',
            ocrSpaceMaskedKey: '',
            keySet: false,
            source: '',
            eff: { apiUrl: '', model: '', textModel: '', timeout: 35000, economyMode: true, maxAttempts: 1, dailyLimit: 200, userDailyLimit: 100, dedupMinutes: 10080 },
            form: {
                provider: '',
                apiUrl: '',
                apiKey: '',
                model: '',
                textModel: '',
                timeout: 35000,
                economyMode: true,
                maxAttempts: 1,
                dailyLimit: 200,
                userDailyLimit: 100,
                dedupMinutes: 10080,
                ocrSpaceApiKey: '', ocrSpaceEngine: 2
            }
        }
    },
    computed: {
        sourceText() {
            return this.source === 'db' ? '数据库（App 设置）'
                : this.source === 'env' ? '环境变量（控制台）'
                    : '内置默认'
        }
    },
    onLoad() {
        const u = getUser() || {}
        this.canManage = (u.role || []).indexOf('admin') >= 0
        if (!this.canManage) return
        this.load()
    },
    methods: {
        async load() {
            if (this.loading) return
            this.loading = true
            try {
                const r = await callCloud('doc-ocr', 'getConfig', {})
                this.maskedKey = r.maskedKey || ''
                this.ocrSpaceMaskedKey = r.ocrSpaceMaskedKey || ''
                this.form.ocrSpaceEngine = (r.config && r.config.ocrSpaceEngine) || 2
                this.keySet = !!r.keySet
                this.source = r.source || 'default'
                this.eff = Object.assign({}, this.eff, r.config || {})
                this.eff.economyMode = !r.config || r.config.economyMode !== false
                if (this.eff.economyMode) {
                    this.eff.maxAttempts = 1
                    this.eff.dedupMinutes = Math.max(10080, Number(this.eff.dedupMinutes) || 0)
                }
                // 用生效配置预填表单（apiKey 不回填明文）
                this.form.apiUrl = this.eff.apiUrl
                this.form.model = this.eff.model
                this.form.textModel = this.eff.textModel
                this.form.timeout = this.eff.timeout
                this.form.economyMode = this.eff.economyMode
                this.form.maxAttempts = this.eff.maxAttempts
                this.form.dailyLimit = this.eff.dailyLimit
                this.form.userDailyLimit = this.eff.userDailyLimit
                this.form.dedupMinutes = this.eff.dedupMinutes
                this.form.provider = this.matchPreset(this.eff.apiUrl, this.eff.model)
                this.loaded = true
            } catch (e) {
                uni.showModal({ title: '读取失败', content: e.message || '请稍后重试', showCancel: false })
            } finally {
                this.loading = false
            }
        },
        changeEconomyMode(event) {
            if (this.saving || this.loading) return
            this.form.economyMode = !!event.detail.value
            if (this.form.economyMode) {
                this.form.maxAttempts = 1
                this.form.dedupMinutes = Math.max(10080, Number(this.form.dedupMinutes) || 0)
            }
        },
        matchPreset(apiUrl, model) {
            for (const k of Object.keys(PROVIDER_PRESETS)) {
                const p = PROVIDER_PRESETS[k]
                if (p.apiUrl === apiUrl && p.model === model) return k
            }
            return ''
        },
        applyPreset(key) {
            if (this.saving || this.loading) return
            const f = presetToForm(key)
            this.form.provider = key
            this.form.apiUrl = f.apiUrl
            this.form.model = f.model
            this.form.textModel = f.textModel
        },
        async save() {
            if (this.saving || this.loading) return
            if (!/^https?:\/\//.test(String(this.form.apiUrl || '').trim())) {
                uni.showToast({ title: 'API 地址须以 http(s):// 开头', icon: 'none' })
                return
            }
            if (!String(this.form.model || '').trim() || !String(this.form.textModel || '').trim()) {
                uni.showToast({ title: '图片/文本模型不能为空', icon: 'none' })
                return
            }
            this.saving = true
            try {
                const r = await callCloud('doc-ocr', 'setConfig', {
                    config: {
                        apiUrl: this.form.apiUrl,
                        ocrSpaceApiKey: this.form.ocrSpaceApiKey, ocrSpaceEngine: Number(this.form.ocrSpaceEngine) || 2,
                        apiKey: this.form.apiKey,
                        model: this.form.model,
                        textModel: this.form.textModel,
                        timeout: Number(this.form.timeout) || 35000,
                        economyMode: this.form.economyMode,
                        maxAttempts: this.form.economyMode ? 1 : Number(this.form.maxAttempts) || 1,
                        dailyLimit: Number(this.form.dailyLimit) || 0,
                        userDailyLimit: Number(this.form.userDailyLimit) || 0,
                        dedupMinutes: this.form.economyMode ? Math.max(10080, Number(this.form.dedupMinutes) || 0) : Number(this.form.dedupMinutes) || 0
                    }
                })
                this.maskedKey = r.maskedKey || ''
                this.keySet = !!r.keySet
                this.source = 'db'
                this.form.apiKey = ''
                this.form.ocrSpaceApiKey = ''
                uni.showToast({ title: '已保存，约 60 秒内生效', icon: 'none', duration: 2000 })
                await this.load()
            } catch (e) {
                uni.showModal({ title: '保存失败', content: e.message || '请重试', showCancel: false })
            } finally {
                this.saving = false
            }
        }
    }
}
</script>

<style scoped>
.page { padding: 16rpx; min-height: 100vh; background: #F2F4F3; }
.card { background: #fff; border-radius: 16rpx; padding: 22rpx; margin-bottom: 16rpx; box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.03); }
.card-title { font-size: 28rpx; font-weight: 700; color: #1f2622; margin-bottom: 12rpx; }
.tip { font-size: 22rpx; color: #77827D; line-height: 1.5; margin-top: 8rpx; }
.noauth { font-size: 26rpx; color: #D9534F; text-align: center; padding: 20rpx 0; }
.presets { display: flex; flex-wrap: wrap; gap: 12rpx; }
.preset { padding: 16rpx 20rpx; border-radius: 12rpx; background: #F4F7F6; font-size: 24rpx; color: #4a554f; border: 1rpx solid #E3E8E5; }
.preset.active { background: #008577; color: #fff; border-color: #008577; }
.preset.disabled { pointer-events: none; opacity: 0.5; }
.field { display: flex; align-items: center; background: #F4F7F6; border-radius: 12rpx; padding: 0 18rpx; min-height: 84rpx; margin-bottom: 12rpx; }
.lbl { width: 170rpx; font-size: 26rpx; color: #77827D; flex-shrink: 0; }
.inp { flex: 1; height: 84rpx; font-size: 26rpx; background: transparent; }
.kv { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 0; border-bottom: 1rpx dashed #E3E8E5; font-size: 26rpx; color: #4a554f; }
.kv:last-child { border-bottom: none; }
.kv .mono { font-family: monospace; font-size: 22rpx; text-align: right; color: #1f2622; max-width: 65%; word-break: break-all; }
.btn { font-size: 28rpx; border-radius: 12rpx; height: 84rpx; line-height: 84rpx; background: #EEF3F1; color: #1f2622; }
.btn.primary { background: #008577; color: #fff; font-weight: 700; }
.btn[disabled] { opacity: 0.5; }
</style>
