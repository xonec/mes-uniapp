# AGENTS.md

## 项目概况

MES 生产助手（`mes-uniapp`）——面向生产线现场的**包材计算助手**，一套代码多端编译：

- **安卓 App**（`APP-PLUS`）：现场主力端，具备帆软（内网）抓取能力
- **微信小程序**（`MP-WEIXIN`）：扫码即用，支持分享
- **H5**：备用

技术栈：**uni-app（Vue）** 前端 + **uniCloud（支付宝云）** 云函数与云数据库。工程由 HBuilderX 直接编译发行，**不依赖任何 npm 包**（根目录 `package.json` 仅提供 `npm test` 脚本，无需 install）。

核心业务：录入批号 → 计算每桶件数 / 包材用量 / 托数 → 保存生产记录并多端共享，带版本历史与乐观锁。

## 常用命令

运行 / 发行 / 上传云函数全部通过 HBuilderX 图形界面，无 CLI 命令。单元测试统一用 `npm test`（根目录 `package.json` 只提供脚本，**不依赖任何 npm 包**，无需 install）：

```bash
npm test              # 全部：calc + mixins + bom + batch-parse + fr-fetch + mes-common + product-bom + product-materials + production-records
npm run test:calc     # 只跑包材计算引擎
npm run test:mixins   # 只跑 mixins（card-layout / history）
npm run test:bom      # 只跑 BOM 计算（.mjs）
npm run test:batch    # 只跑批号解析（扫码/相册识别提取批号）
npm run test:fr       # 只跑帆软取数纯函数（cjkEncode / parseTable / 汇总）
npm run test:bomdb    # 只跑产品 BOM 云函数（.cjs）
npm run test:pmat     # 只跑产品物料清单档案云函数（.cjs）
npm run test:common   # 只跑云函数公共模块
npm run test:records  # 只跑生产记录云函数（含内存版 uniCloud mock）
```

> 云函数改动后必须在 HBuilderX 中**右键上传部署**才生效；微信小程序上线必须用【**发行**】菜单产物，不能用【运行】产物。

## 架构说明

```text
mes-uniapp/
├── pages/                          # 页面：login(启动) + tabBar 4 页：materials(计算)/history(历史)/archive(档案)/me(我的)；另有 scan(自定义扫码页)/user-manage / change-password 子页
├── components/                     # 卡片组件：batch / buckets / prod / material / weight / pallet
├── utils/
│   ├── calc.js                     # 包材计算引擎（computeMaterial / computeWeightRange）★核心
│   ├── bom.js / bom-db.js          # 产品 BOM 计算纯函数 + product-bom 云函数封装
│   ├── product-materials-db.js     # 产品物料档案（product-materials 云函数）封装
│   ├── product-data.js             # 产品目录硬编码（BOM 兜底，待灌库后移除）
│   ├── auth.js                     # 登录鉴权封装（调 uni-auth 云函数）
│   ├── production-db.js            # 生产记录读写封装（调 production-records 云函数）
│   ├── cloud-db.js                 # 每桶件数云端读写（调 batch-buckets 云函数）
│   ├── fr-fetch.js / fr-config.js  # 帆软（内网）抓取：uni.request 三步法（App/小程序/H5 通用），必须带桌面 UA（帆软按 UA 区分移动端）★核心
│   ├── cloud-call.js               # 云函数统一调用（带 token / 解析协议 / 401 跳登录）
│   ├── app-version.js              # App 端版本检查（小程序/H5 被条件编译剔除）
│   └── device.js                   # 设备 ID（草稿按「用户 + 设备」隔离）
├── static/tabbar/                  # 底部导航图标（4 图标 × 普通/选中，占位可替换）
├── uniCloud-alipay/
│   ├── cloudfunctions/
│   │   ├── user-admin/             # 用户管理薄封装（列表/个人资料）
│   │   ├── production-records/     # 生产记录 upsert（乐观锁 + 版本归档）+ 草稿 ★核心
│   │   ├── batch-buckets/          # 每桶件数（内网 → 云端同步桥）
│   │   ├── product-bom/            # 产品 BOM（product_bom）读写
│   │   ├── product-materials/      # 产品物料档案（product_materials）读写
│   │   ├── app-version/            # App 版本检查（get 公开 / set 管理员）
│   │   └── common/mes-common/      # 公共模块：鉴权(checkAuth·checkAdmin，委托 uni-id) / 响应封装 / ClientError ★核心
│   └── database/                   # 集合 schema：production_records / _versions / _drafts / batch_buckets / product_bom / product_materials / uni-id-users / app_versions
├── tests/                          # Node 自建单元测试
└── uni.scss                        # 全局颜色变量
```

数据流与关键约束：

- 生产记录主表 `production_records` 固定 `_id = rec:批号`，覆盖写存最新版；旧版归档到 `production_record_versions`（`_id = ver:批号:版本号`）。
- 保存时**仅内容变化才升版本并归档**，内容相同则幂等（不升版本、不归档）。
- 鉴权走官方 **uni-id**（登录/建号/改密/重置/禁用 = `uni-id-co` 云对象；token 校验 = `uni-id-common`，JWT）。token 密钥在 `uni-config-center/uni-id/config.json`（真实随机值）。
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
