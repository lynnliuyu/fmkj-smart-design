# M6 管理后台和运营能力完成状态

更新日期：2026-06-30

## 结论

M6 主干已完成。当前实现已经覆盖超级管理员账号管理、企业管理、套餐管理、订单查看、平台功能开关、操作日志、数据统计，以及普通用户访问超管后台接口的拦截。

## 已完成

| 验收项 | 状态 | 代码入口 |
| --- | --- | --- |
| 超级管理员可以查看全部账号 | 已完成 | `/admin/customers`, `/api/admin/customers`, `/api/admin/accounts` |
| 超级管理员可以禁用和恢复账号 | 已完成 | `/api/admin/customers/[id]`, `/api/admin/accounts/[id]` |
| 超级管理员可以修改账号套餐 | 已完成 | `/api/admin/customers/[id]/subscription`, `/api/admin/accounts/[id]/subscription` |
| 超级管理员企业管理接口和页面 | 已完成 | `/admin/organizations`, `/api/admin/organizations` |
| 超级管理员可以修改企业套餐和订阅状态 | 已完成 | `/api/admin/organizations/[id]/subscription` |
| 超级管理员可以修改套餐配置 | 已完成 | `/admin/plans`, `/api/admin/plans/[id]` |
| 超级管理员可以查看订单 | 已完成 | `/admin/orders`, `/api/admin/orders` |
| 平台功能开关接口和页面 | 已完成 | `/admin/feature-flags`, `/api/admin/feature-flags` |
| 关键管理操作写入操作日志 | 已完成 | `recordPlatformActivity`, `/admin/audit-logs` |
| 数据统计接口和页面 | 已完成 | `/admin/analytics`, `/api/admin/analytics` |
| 普通用户不能访问超级管理员后台接口 | 已完成 | `requireSuperAdmin`, `tests/admin-routes.test.ts` |
| 超管后台入口 | 已完成 | `/admin`, `components/app-sidebar.tsx` |

## 实现说明

- 账号管理同时保留 `/api/admin/customers` 和规格文档中的 `/api/admin/accounts`，二者复用同一套服务逻辑。
- 企业角色使用 `organization_roles`，不复用登录认证的 `roles` 表，避免和 `roles.key` 约束冲突。
- 功能开关持久化在 `feature_flags` 表，并在账号权限解析时参与计算。
- 功能开关审计日志使用 `entity_type = feature_flag`，`entity_id` 仍使用操作者 UUID 以满足现有 `activity_logs.entity_id` 的 UUID 类型约束。
- 数据统计覆盖账号、企业、订阅、订单、已支付金额和操作热度。

## 已知剩余风险

- 部分旧页面仍有历史乱码文案，例如账号、套餐、功能开关的局部表单文案；不影响 M6 核心逻辑，但会影响运营体验。
- 订单目前是只读管理；支付、退款、发票等流程尚未实现。
- 审计日志已覆盖平台管理关键操作，但仍可继续补更细的数据库级集成测试。
- 未进行浏览器端逐页冒烟截图验证；当前验证以测试、类型检查、lint 和迁移为主。

## 验证命令

当前收口验证使用：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm db:migrate
```
