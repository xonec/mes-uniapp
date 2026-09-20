# uniCloud（支付宝云）部署说明

本项目已关联 **支付宝云** 服务空间，`uniCloud-alipay/` 是云端代码目录。

## 目录结构

**集合 Schema（6 个）**

- `database/batch_buckets.schema.json`：桶件数（客户端不可读写，读写走云函数）
- `database/production_records.schema.json`：生产记录最新版（客户端不可读写，走云函数）
- `database/production_record_versions.schema.json`：生产记录历史版本（客户端不可读写）
- `database/production_drafts.schema.json`：草稿表（客户端不可读写，走云函数按「用户 + 设备」隔离）
- `database/uni-id-users.schema.json`：用户表（客户端不可读写，仅云函数操作）
- `database/app_versions.schema.json`：App 版本发布信息（单文档 latest；写走云函数、读为公开接口）

**索引（2 个）**

- `database/production_records.index.json`：updatedAt 索引（历史排序）
- `database/production_record_versions.index.json`：batchNo+version 复合索引（版本查询）

**公共模块（1 个）**

- `cloudfunctions/common/mes-common/`：token 校验 / 鉴权 / 统一响应封装（3 个云函数共享）

**云函数（4 个）**

- `cloudfunctions/batch-buckets/`：桶件数读写（upsert / get）
- `cloudfunctions/production-records/`：生产记录读写 + 版本 + 回滚 + 草稿（upsert / get / list / listVersions / rollback / saveDraft / getDraft）
- `cloudfunctions/uni-auth/`：登录鉴权（login / createUser / checkLogin / init / listUsers / deleteUser / setUserStatus / changePassword / resetPassword）
- `cloudfunctions/app-version/`：App 版本检查（get 公开 / set 管理员）

## 密钥与环境变量（重要）

密钥**不再硬编码到源码**，改为从云函数环境变量读取，需在支付宝云控制台为 3 个云函数分别配置：

| 变量名 | 必填 | 说明 |
| --- | --- | --- |
| `MES_TOKEN_SECRET` | 是 | token 签名密钥（HMAC-SHA256），3 个云函数必须配同一个值 |
| `MES_LEGACY_PASSWORD_SECRET` | 否 | 旧密码哈希的 pepper，仅用于把老账号密码透明迁移到新格式；所有老账号登录一轮后可删除 |

- 生成 `MES_TOKEN_SECRET`：`openssl rand -hex 32`
- 未配置 `MES_TOKEN_SECRET` 时，云函数会返回明确错误。
- 密码存储已改为 scrypt 加盐哈希（`scrypt$<salt>$<hash>`）。老格式（无盐 sha256）在登录时自动兼容并透明升级。

## 部署步骤（HBuilderX）

1. **配置环境变量**：3 个云函数各配 `MES_TOKEN_SECRET`（同一随机值）；如要兼容老账号，再配 `MES_LEGACY_PASSWORD_SECRET`（值 = 旧 passwordSecret）。
2. **上传 Schema（建集合）**：右键 6 个 `.schema.json` → 「上传数据集合 Schema」。
3. **初始化索引**：右键 2 个 `.index.json` → 「初始化云数据库索引」。
4. **上传公共模块 + 云函数**：先右键 `cloudfunctions/common/mes-common` → 「上传公共模块」，再右键 4 个云函数目录 → 「上传部署」→ 「全部文件」（自动带上 mes-common 依赖）。
5. **初始化 admin 账号**：HBuilderX 云函数测试调 `uni-auth`，参数 `{ "action": "init" }`（仅用户表为空时生效）。不传 password 时会返回随机生成的强密码 `initPassword`，请立即记录并妥善保存。

## 登录鉴权

- 所有**读写操作**都需登录：云函数校验 `event.uniIdToken` 并**回查用户表验证账号状态**，未登录/失效返回 `code: 401`，前端自动跳登录页。
- **token 服务端吊销**：禁用/删除账号后，其已签发 token 立即失效（每次鉴权都回查用户表 `status`）。
- **登录防爆破**：连续密码错误 5 次锁定 15 分钟（字段 `loginFailCount` / `lockUntil`），登录成功清零。
- 每次写入记录 `savedBy`（操作人 uid），配合版本历史可追溯「谁改的」。
- 账号管理：`admin` 登录后进入「用户管理」页（包材页顶部「用户管理」条仅管理员可见）可**新建 / 列表 / 启用禁用 / 删除**账号，全部走 `uni-auth` 的 `createUser` / `listUsers` / `setUserStatus` / `deleteUser` 动作。
  - 新建时可指定角色（普通用户 / 管理员），服务端仅接受 `user` / `admin`，且仅管理员能授予 `admin`。
  - 删除 / 禁用均不能作用于自己。
  - 非管理员进入「用户管理」页会自动跳回主页。

## 密码修改与失效

- **本人改密**：主页底部「修改密码」入口 → `changePassword`（校验原密码，至少 6 位）。
- **管理员重置**：用户管理页每行「重置密码」→ `resetPassword`（不能重置自己）。
- 用户表有 `pwdVersion`（初始 1），token 载荷含 `pv`；改密/重置时 `pwdVersion+1`，**旧 token 立即失效**（其它设备/被重置者需重新登录）。本人改密后本机自动续期新 token。
- 兼容性：本次改动前签发的旧 token 无 `pv`，按 `pv=1` 处理，与 `pwdVersion` 缺省值一致，故不会立刻掉线。

## 草稿隔离（用户 + 设备）

- 草稿存 `production_drafts`，`_id = draft:<uid>:<设备ID>:<批号>`，按「用户 + 设备」双重隔离。
- `uid` 由服务端从 token 解析（客户端无法伪造）；`设备ID` 是安装时生成的本机标识（卸载重装会变）。
- 点「保存」时：写共享记录 + 写本人本设备草稿；启动时自动从云端恢复本人本设备草稿。

## 版本历史

- 每次保存/回滚前，旧记录归档到 `production_record_versions`（`_id = ver:<批号>:<版本号>`，追加不覆盖）。
- 写入用**乐观锁**（按 `version` 条件更新）防并发丢版本，冲突自动重试。
- 每批最多保留 50 个历史版本，超出自动删最老。

## 权限模型

- 读、写**都走云函数**（schema 客户端权限全 `false`），云函数内统一登录鉴权，未登录无法访问任何生产数据。
- 私密数据（用户表、草稿表）同样只能走云函数。

## 注意事项

- 支付宝云 `add` **不会自动建表**：集合必须先「上传 Schema」创建。
- 修改 Schema / 云函数后必须重新上传才生效。
- **改了公共模块 `mes-common` 后，必须重传所有依赖它的云函数**，否则线上跑的还是旧模块。
- 轮换 `MES_TOKEN_SECRET` 会导致已下发 token 失效，需重新登录。
- 微信小程序端连支付宝云，需在小程序后台配置 request 合法域名；App 端无此限制。
- 云函数返回统一协议 `{ code, message, data }`（code 0 成功，data 放结果）。

## App 版本更新（可选）

- 客户端启动时调 `app-version` 的 `get`，把云端 `versionName` 与 `plus.runtime.version` 比较，有新版则弹窗并可跳转下载地址；失败静默，不影响启动。
- 发布新版本时用管理员调 `set` 写入（也可直接在 uniCloud 控制台的 `app_versions` 集合里改 `latest` 文档）：
  ```json
  { "action": "set", "uniIdToken": "<管理员token>",
    "versionName": "1.2.0", "versionCode": 120,
    "url": "https://下载地址/app.apk", "notes": "修复…", "force": false }
  ```
- **每次发版记得同步递增 `manifest.json` 的 `versionName` / `versionCode`**，否则客户端认为自己已是最新。

## 帆软报表地址

- `utils/fr-config.js` 的 `base` 只是出厂默认值；运行时可被覆盖（管理员在「用户管理」页设置，写入本地 storage `fr_base_override`），换服务器/IP 无需重新打包。
- 该地址仅安卓 App 的「从帆软(内网)获取」使用。
- `uni_modules/` 下的 `uni-id-common` / `uni-config-center` 已删除（云函数依赖 `common/mes-common`，自包含鉴权）。
- 若公共模块解析失败（个别支付宝云环境），可在 HBuilderX 右键云函数 → 「管理公共模块依赖」重新勾选 `mes-common` 生成正确路径。
