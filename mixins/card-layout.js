// 卡片折叠 / 排序 / 长按拖拽（从 materials.vue 抽出，纯 UI 状态，无业务依赖）
//
// 使用方需在模板中绑定：cardList / dragMode / dragKey，以及
// toggleCard / startDrag / onDragMove / endDrag。

import { STORE_LAYOUT } from '@/utils/storage-keys.js'

// 卡片定义（默认顺序与标题）
const CARD_DEFS = [
    { key: 'batch', title: '批号 / 产品' },
    { key: 'buckets', title: '分桶件数' },
    { key: 'prod', title: '生产数据' },
    { key: 'material', title: '包材用量' },
    { key: 'weight', title: '重量参数' },
    { key: 'pallet', title: '每托件号' }
]
const CARD_KEYS = CARD_DEFS.map(c => c.key)

export default {
    data() {
        return {
            // 卡片折叠与排序（顺序由 cardList 数组决定）
            cardList: CARD_DEFS.map(c => ({ key: c.key, title: c.title, collapsed: false })),
            // 拖拽排序状态
            dragMode: false,
            dragKey: '',
            dragIndex: -1,
            dragY: 0,
            cardTops: [],
            cardH: 0
        }
    },
    methods: {
        toggleCard(key) {
            if (this._noTap) return
            const c = this.cardList.find(x => x.key === key)
            if (c) { c.collapsed = !c.collapsed; this.saveCardLayout() }
        },
        moveCard(idx, dir) {
            const j = idx + dir
            if (j < 0 || j >= this.cardList.length) return
            const arr = this.cardList
            const t = arr[idx]
            arr.splice(idx, 1)
            arr.splice(j, 0, t)
            this.saveCardLayout()
        },
        saveCardLayout() {
            const order = this.cardList.map(c => c.key)
            const collapsed = {}
            this.cardList.forEach(c => { collapsed[c.key] = c.collapsed })
            uni.setStorageSync(STORE_LAYOUT, { order, collapsed })
        },
        loadCardLayout() {
            const saved = uni.getStorageSync(STORE_LAYOUT)
            if (!saved || !Array.isArray(saved.order) || !saved.order.length) return
            const ord = saved.order.filter(k => CARD_KEYS.includes(k))
            CARD_KEYS.forEach(k => { if (!ord.includes(k)) ord.push(k) })
            const map = {}
            ord.forEach((k, i) => { map[k] = i })
            this.cardList = CARD_DEFS.map(c => ({
                key: c.key, title: c.title, collapsed: !!(saved.collapsed && saved.collapsed[c.key])
            }))
            // 重新排列 cardList 顺序
            this.cardList.sort((a, b) => (map[a.key] - map[b.key]))
        },
        // ===== 长按拖拽排序 =====
        measureTops() {
            uni.createSelectorQuery().in(this).selectAll('.card').boundingClientRect().exec(res => {
                const rects = (res && res[0]) || []
                this.cardTops = rects.map(r => r.top)
                if (rects[0]) this.cardH = rects[0].height
            })
        },
        startDrag(key, idx, e) {
            this.dragKey = key
            this.dragIndex = idx
            this.dragMode = true
            this.lockPageScroll()
            this.$nextTick(() => {
                this.measureTops()
                // 记录起始手指 Y（优先用事件触点）
                const t = e && e.touches && e.touches[0]
                if (t && typeof t.clientY === 'number') this.dragY = t.clientY
            })
        },
        // 锁定页面滚动（App/H5：非被动 touchmove + preventDefault；微信端由 page-meta 处理）
        lockPageScroll() {
            // #ifdef APP-PLUS || H5
            if (typeof document === 'undefined') return
            if (!this._preventScroll) {
                this._preventScroll = (ev) => { ev.preventDefault() }
                document.addEventListener('touchmove', this._preventScroll, { passive: false })
            }
            // #endif
        },
        unlockPageScroll() {
            // #ifdef APP-PLUS || H5
            if (typeof document === 'undefined') return
            if (this._preventScroll) {
                document.removeEventListener('touchmove', this._preventScroll)
                this._preventScroll = null
            }
            // #endif
        },
        onDragMove(e) {
            if (!this.dragMode) return
            if (e && e.preventDefault) e.preventDefault()
            const t = e.touches[0]
            if (!t) return
            this.dragY = t.clientY
            if (!this.cardTops.length) return
            let target = this.cardTops.findIndex(top => this.dragY < top + this.cardH / 2)
            if (target < 0) target = this.cardTops.length - 1
            if (target !== this.dragIndex && target >= 0) {
                const arr = this.cardList
                const item = arr[this.dragIndex]
                arr.splice(this.dragIndex, 1)
                arr.splice(target, 0, item)
                this.dragIndex = target
                this.$nextTick(() => this.measureTops())
            }
        },
        endDrag() {
            if (!this.dragMode) return
            this.dragMode = false
            this.dragKey = ''
            this.dragIndex = -1
            this.cardTops = []
            this.unlockPageScroll()
            this.saveCardLayout()
            // 松手后短暂屏蔽点击，避免长按松手误触折叠
            this._noTap = true
            setTimeout(() => { this._noTap = false }, 350)
        }
    }
}
