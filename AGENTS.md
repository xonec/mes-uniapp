# AGENTS.md

## 项目概况

MES 生产助手（`mes-uniapp`）——面向生产线现场的**包材计算助手**，一套代码多端编译：

- **安卓 App**（`APP-PLUS`）：现场主力端，具备帆软（内网）抓取能力
- **微信小程序**（`MP-WEIXIN`）：扫码即用，支持分享
- **H5**：备用

技术栈：**uni-app（Vue）** 前端 + **uniCloud（支付宝云）** 云函数与云数据库。工程由 HBuilderX 直接编译发行，**没有 npm 依赖层**。

核心业务：录入批号 → 计算每桶件数 / 包材用量 / 托数 → 保存生产记录并多端共享，带版本历史与乐观锁。

## 常用命令

本工程没有 `package.json`，运行 / 发行 / 上传云函数全部通过 HBuilderX 图形界面，无 CLI 命令。仅单元测试可用 Node 直接运行：

```bash
# 包材计算引擎单元测试
node --experimental-detect-module tests/calc.test.mjs

# 云函数公共模块单元测试
node tests/mes-common.test.cjs

# 生产记录云函数单元测试（含内存版 uniCloud mock）
node tests/production-records.test.cjs
```

> 云函数改动后必须在 HBuilderX 中**右键上传部署**才生效；微信小程序上线必须用【**发行**】菜单产物，不能用【运行】产物。

## 架构说明

```text
mes-uniapp/
├── pages/                          # 页面：login(自定义导航) / materials(主页) / user-manage
├── components/                     # 卡片组件：batch / buckets / prod / material / weight / pallet
├── utils/
│   ├── calc.js                     # 包材计算引擎（computeMaterial / computeWeightRange）★核心
│   ├── product-data.js             # 产品目录与批号 → 产品匹配
│   ├── auth.js                     # 登录鉴权封装（调 uni-auth 云函数）
│   ├── production-db.js            # 生产记录读写封装（调 production-records 云函数）
│   ├── cloud-db.js                 # 每桶件数云端读写（调 batch-buckets 云函数）
│   ├── fr-fetch.js / fr-config.js  # 帆软（内网）抓取，仅 Android 走 plus.webview ★核心
│   ├── cloud-call.js               # 云函数统一调用（带 token / 解析协议 / 401 跳登录）
│   ├── app-version.js              # App 端版本检查（小程序/H5 被条件编译剔除）
│   └── device.js                   # 设备 ID（草稿按「用户 + 设备」隔离）
├── libs/xlsx.full.min.js           # 解析帆软导出的表格
├── uniCloud-alipay/
│   ├── cloudfunctions/
│   │   ├── uni-auth/               # 登录鉴权、建号、改密/重置、token 签发与校验
│   │   ├── production-records/     # 生产记录 upsert（乐观锁 + 版本归档）+ 草稿 ★核心
│   │   ├── batch-buckets/          # 每桶件数（内网 → 云端同步桥）
│   │   ├── app-version/            # App 版本检查（get 公开 / set 管理员）
│   │   └── common/mes-common/      # 公共模块：token / 鉴权(checkAuth·checkAdmin) / 响应封装 ★核心
│   └── database/                   # 集合 schema：production_records / _versions / _drafts / batch_buckets / uni-id-users / app_versions
├── tests/                          # Node 自建单元测试
└── uni.scss                        # 全局颜色变量
```

数据流与关键约束：

- 生产记录主表 `production_records` 固定 `_id = rec:批号`，覆盖写存最新版；旧版归档到 `production_record_versions`（`_id = ver:批号:版本号`）。
- 保存时**仅内容变化才升版本并归档**，内容相同则幂等（不升版本、不归档）。
- 鉴权 token 无状态（HMAC 签名，有效期 7 天），多端可用同一账号并发登录；防爆破锁定是**账号级**的。
- 微信小程序 request 合法域名须配置 `https://env-00jy6try6qr3.api-hz.cloudbasefunction.cn`（支付宝云，spaceId `env-00jy6try6qr3`）。

## 编码约定

查看`.workbuddy/rules/编码风格.md`,请遵守其中约束,有任何问题请反馈到用户决策。

## 测试约定

查看`.workbuddy/rules/测试约定.md`,请遵守其中约束,有任何问题请反馈到用户决策。

## 提交规范

查看`.workbuddy/rules/提交规范.md`,请遵守其中约束,有任何问题请反馈到用户决策。

## Superpowers 规则

### 核心约定（必须遵守）

- 默认在当前对话内直接输出背景、功能边界、目标、非目标、关键决策、计划、风险、协议与验收标准，不在 `docs/superpowers/specs/`、`docs/superpowers/plans/` 下新建文档。需要草图时用 `.workbuddy/skills/wireframe/SKILL.md` 技能在终端输出。
- 只有高复杂度需求才可提议建档，且须先征得用户确认。高复杂度指：改动跨 2 个以上子项目或模块，其余情形一律按一般复杂度处理。
- brainstorming 阶段聚焦架构设计、设计模式、技术选型与方法复用。未经用户同意不生成 `.superpowers/brainstorm/*.html` 预览页面，简单的需求使用 `.workbuddy/skills/wireframe/SKILL.md` 技能在终端生成草图，辅助用户理解。
- 设计与规划阶段的 using-git-worktrees 技能，没有得到用户的同意，不要轻易新建并行分支，直接在主分支开发。
- 任务执行阶段，不要轻易使用*子代理执行（Subagent）*，尽可能使用*内联在当前对话执行（Inline Current Conversation）*执行方式，特殊场景下需要通过子代理执行时，必须经过用户确认。
- 代码审查阶段，不要轻易执行 lint 检查、test 测试、启动开发服务、使用 playwright 等操作，消耗大量时间和资源，必要时经过用户确认。
