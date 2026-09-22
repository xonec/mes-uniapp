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

**公共模块（3 个）**

- `cloudfunctions/common/mes-common/`：鉴权（checkAuth / checkAdmin，委托 uni-id）+ 统一响应封装 + ClientError
- `cloudfunctions/common/uni-id-common/`：uni-id token 签发/校验（官方）
- `cloudfunctions/common/uni-config-center/`：配置中心，承载 `uni-id/config.json`（tokenSecret / passwordSecret）

**云函数（6 个）**

- `cloudfunctions/batch-buckets/`：桶件数读写（upsert / get）
- `cloudfunctions/production-records/`：生产记录读写 + 版本 + 回滚 + 草稿
- `cloudfunctions/product-bom/`：产品 BOM 读写
- `cloudfunctions/product-materials/`：产品物料档案读写
- `cloudfunctions/user-admin/`：用户管理薄封装（listUsers / profile）
- `cloudfunctions/app-version/`：App 版本检查（get 公开 / set 管理员）

## 鉴权（官方 uni-id）

登录 / 建号 / 改密 / 重置 / 禁用走云对象 `uni-id-co`（uni_modules 内，随「上传所有云函数、公共模块」部署）；token 校验走 `uni-id-common`（`mes-common.checkAuth` 委托它）。

- 密钥在 `cloudfunctions/common/uni-config-center/uni-id/config.json`（真实随机值，**勿用 demo 值**）。
- 所有读写云函数校验 `event.uniIdToken`，未登录/失效返回 `code: 401`，前端自动跳登录页。
- 账号管理：管理员进「用户管理」页可新建/列表/启用禁用/删除/重置密码，走 `uni-id-co.addUser / updateUser` + `user-admin.listUsers`。

## 部署步骤（HBuilderX）

1. 上传 Schema（建集合）：右键 `database` → 上传所有 DB Schema（含 index.json 索引）。
2. 上传公共模块 + 云函数：右键 `uni_modules` → 上传所有云函数、公共模块（含 uni-id-co + 3 个 common 模块）；再右键 `cloudfunctions` → 上传所有云函数。
3. 首个管理员：admin 项目注册管理员，或直接访问 `#/uni_modules/uni-id-pages/pages/register/register-admin`。

## 密码与账号状态

- 本人改密：主页「修改密码」→ `uni-id-co.updatePwd`。
- 管理员重置：用户管理页「重置密码」→ `uni-id-co.updateUser({ id, password })`。
- 账号状态（uni-id 语义）：`status` 0=正常 / 1=封禁 / 2·3=审核 / 4=注销；禁用=status 1，删除=status 4（注销）。

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
- 轮换 `uni-config-center/uni-id/config.json` 的 tokenSecret 会导致已下发 token 失效，需重新登录。
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
- `uni_modules/` 下的 `uni-id-common` / `uni-config-center` 已复制进 `cloudfunctions/common/`（云函数依赖 `common/uni-id-common`，其依赖 `common/uni-config-center`）。
- 若公共模块解析失败（个别支付宝云环境），可在 HBuilderX 右键云函数 → 「管理公共模块依赖」重新勾选 `mes-common` 生成正确路径。
