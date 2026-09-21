// 本地 storage 键名集中定义（页面与 mixin 共用，避免散落重复）
// 改键名只需改这里。

export const STORE_RESULTS = 'mes-material-results'   // 按批号缓存的计算结果
export const STORE_HISTORY = 'mes-production-history' // 最近保存的批号列表
export const STORE_DRAFT = 'mes-production-draft'     // 本机草稿（断点恢复）
export const STORE_LAYOUT = 'mes-card-layout'         // 卡片顺序与折叠状态
export const STORE_SHARE_BATCH = 'mes-share-batch'    // 分享进入时暂存的批号
