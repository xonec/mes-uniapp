<template>
    <view class="page">
        <view class="card">
            <view class="card-title">识别服务设置（管理员）</view>
            <view class="tip">切换 OCR 供应商 / 模型，无需重传云函数，保存后约 60 秒内生效。Key 仅在服务端使用，不会以明文下发。</view>
        </view>

        <view class="card">
            <view class="card-title">我的识别额度与 Key</view>
            <view class="tip">内置 Key 每日限额：今日已用 {{ my.used }} 次{{ my.dailyLimit ? '（上限 ' + my.dailyLimit + ' 次／天）' : '（不限）' }}。填写自己的 API Key 后，识别优先使用你的 Key，不占用内置额度。</view>
            <view class="presets" style="margin-top: 12rpx;">
                <view class="preset" v-for="p in ownProviders" :key="p.value"
                      :class="{ active: ownProvider === p.value, disabled: mySaving }" @tap="chooseOwnProvider(p.value)">{{ p.label }}</view>
            </view>
            <view class="field">
                <text class="lbl">我的 Key</text>
                <input class="inp" v-model="ownKeyInput" password :disabled="mySaving"
                       :placeholder="my.keySet ? ('已设置（' + my.maskedKey + '），留空保留') : '填写自己的 Key 后使用自己的额度'" />
            </view>
            <view class="presets">
                <button class="btn" :disabled="mySaving || !ownKeyInput" @tap="saveOwnKey">{{ mySaving ? '保存中…' : '保存我的 Key' }}</button>
                <button class="btn" v-if="my.keySet" :disabled="mySaving" @tap="clearOwnKey">清除</button>
            </view>
            <view class="tip">Key 只保存在服务端且仅你本人可用；内置 Key 额度用尽时，用自己的 Key 仍可识别。</view>
        </view>

        <view class="card" v-if="!canManage">
            <view class="noauth">以下为管理员配置项，当前账号无权限查看。</view>
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
                    <input class="inp" v-model="form.maxAttempts" type="number" placeholder="2" :disabled="saving || loading" />
                </view>
                <view class="tip">尝试次数包含首次调用，可设置 1～3 次；实际请求总数还受后台「单次模型请求上限」约束。</view>
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
                    <input class="inp" v-model="form.dedupMinutes" type="number" placeholder="10080（7 天）" :disabled="saving || loading" />
                </view>
                <view class="tip">每日上限只限制大模型请求，免费 OCR 额度由 OCR.space 管理。结果复用可设为 0 关闭长期缓存；仍保留 30 分钟的临时结果供确认编码使用，避免重复付费。</view>
            </view>

            <view class="card" v-if="loaded">
                <view class="card-title">当前生效配置</view>
                <view class="kv"><text>来源</text><text>{{ sourceText }}</text></view>
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
            ownProviders: [
                { value: 'deepseek', label: 'DeepSeek 官方' },
                { value: 'siliconflow', label: '硅基流动' }
            ],
            ownProvider: 'deepseek',
            ownKeyInput: '',
            mySaving: false,
            my: { keySet: false, maskedKey: '', providerType: '', dailyLimit: 0, used: 0, builtinReady: false },
            maskedKey: '',
            ocrSpaceMaskedKey: '',
            keySet: false,
            source: '',
            eff: { apiUrl: '', model: '', textModel: '', timeout: 35000, maxAttempts: 2, dailyLimit: 200, userDailyLimit: 100, dedupMinutes: 10080 },
            form: {
                provider: '',
                apiUrl: '',
                apiKey: '',
                model: '',
                textModel: '',
                timeout: 35000,
                maxAttempts: 2,
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
        // 我的额度与自带 Key 对所有登录用户开放
        this.loadMyKey()
        if (this.canManage) this.load()
    },
    methods: {
        async loadMyKey() {
            try {
                const r = await callCloud('doc-ocr', 'getMyKey', {})
                this.my = Object.assign({}, this.my, r || {})
                if (r && r.providerType) this.ownProvider = r.providerType
            } catch (e) { /* 未登录或网络异常时保持默认显示 */ }
        },
        chooseOwnProvider(value) {
            if (this.mySaving) return
            this.ownProvider = value
        },
        async saveOwnKey() {
            if (this.mySaving) return
            const apiKey = String(this.ownKeyInput || '').trim()
            if (!apiKey) { uni.showToast({ title: '请填写自己的 API Key', icon: 'none' }); return }
            this.mySaving = true
            try {
                const r = await callCloud('doc-ocr', 'setMyKey', { providerType: this.ownProvider, apiKey })
                this.my = Object.assign({}, this.my, r || {})
                this.ownKeyInput = ''
                uni.showToast({ title: '已保存，将使用你的 Key', icon: 'none' })
            } catch (e) {
                uni.showModal({ title: '保存失败', content: e.message || '请重试', showCancel: false })
            } finally { this.mySaving = false }
        },
        async clearOwnKey() {
            if (this.mySaving) return
            this.mySaving = true
            try {
                const r = await callCloud('doc-ocr', 'clearMyKey', {})
                this.my = Object.assign({}, this.my, r || {})
                this.ownKeyInput = ''
                uni.showToast({ title: '已清除，恢复内置额度', icon: 'none' })
            } catch (e) {
                uni.showModal({ title: '清除失败', content: e.message || '请重试', showCancel: false })
            } finally { this.mySaving = false }
        },
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
                // 用生效配置预填表单（apiKey 不回填明文）
                this.form.apiUrl = this.eff.apiUrl
                this.form.model = this.eff.model
                this.form.textModel = this.eff.textModel
                this.form.timeout = this.eff.timeout
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
                        maxAttempts: Number(this.form.maxAttempts) || 2,
                        dailyLimit: Number(this.form.dailyLimit) || 0,
                        userDailyLimit: Number(this.form.userDailyLimit) || 0,
                        dedupMinutes: Number(this.form.dedupMinutes) || 0
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
