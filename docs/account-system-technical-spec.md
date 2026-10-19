# 账号体系技术实现规格

## 1. 文档目标

本文档把 `docs/account-tier-and-upgrade-plan.md` 转换为开发可执行的技术规格，覆盖数据表、服务边界、权限判断、接口清单、页面模块和测试用例。

当前规格保持技术栈中立。确定后端框架、数据库和支付渠道后，可将本文档进一步转换为迁移脚本、接口代码和测试代码。

## 2. 核心设计原则

- 账号类型和商业套餐分离。
- 用户身份和企业成员关系分离。
- 权限判断必须以服务端为准。
- 前端权限判断只用于隐藏入口、展示提示和优化体验。
- 付费能力不能只依赖前端禁用。
- 订阅过期、降级和取消时必须保留用户数据。
- 企业子账号的数据归属必须可追踪、可转移。

## 3. 数据表设计

### 3.1 users

保存登录身份和基础资料。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 用户 ID |
| email | varchar | 否 | 邮箱，唯一 |
| phone | varchar | 否 | 手机号，唯一 |
| password_hash | varchar | 否 | 密码哈希；第三方登录可为空 |
| name | varchar | 否 | 显示名称 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- email 和 phone 至少有一个。
- 不在 users 表直接存放套餐、企业角色和权限。

### 3.2 account_profiles

保存账号类型和账号状态。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 账号档案 ID |
| user_id | uuid / bigint | 是 | 关联 users.id |
| account_type | enum | 是 | SUPER_ADMIN / ENTERPRISE_OWNER / ENTERPRISE_MEMBER / PERSONAL_PRO / PERSONAL_FREE |
| account_status | enum | 是 | active / disabled / deleted |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- user_id 唯一。
- disabled 账号不能登录或调用业务接口。
- deleted 账号保留审计记录，不直接物理删除。

### 3.3 organizations

保存企业组织。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 企业 ID |
| name | varchar | 是 | 企业名称 |
| owner_user_id | uuid / bigint | 是 | 企业主账号用户 ID |
| status | enum | 是 | active / disabled / expired / deleted |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- owner_user_id 必须指向有效用户。
- v1 中一个 owner_user_id 默认只拥有一个企业组织。

### 3.4 organization_members

保存企业成员关系。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 成员关系 ID |
| organization_id | uuid / bigint | 是 | 企业 ID |
| user_id | uuid / bigint | 是 | 用户 ID |
| role_id | uuid / bigint | 是 | 角色 ID |
| invited_by_user_id | uuid / bigint | 否 | 邀请人 |
| member_status | enum | 是 | invited / active / disabled / removed |
| joined_at | datetime | 否 | 加入时间 |
| removed_at | datetime | 否 | 移除时间 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- v1 中同一个 user_id 只能有一个 active 企业成员关系。
- removed 成员不能访问企业资源。
- 删除成员时必须先处理数据转移。

### 3.5 roles

保存企业角色。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 角色 ID |
| organization_id | uuid / bigint | 否 | 企业 ID；系统角色可为空 |
| code | varchar | 是 | admin / editor / viewer / finance |
| name | varchar | 是 | 角色名称 |
| is_system | boolean | 是 | 是否系统默认角色 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

默认角色：

- admin：管理员
- editor：编辑者
- viewer：查看者
- finance：财务

### 3.6 permissions

保存权限点。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | varchar | 是 | 权限编码，主键 |
| name | varchar | 是 | 权限名称 |
| description | text | 否 | 权限说明 |

初始权限点：

```text
account.manage_all
platform.manage_features
enterprise.manage_members
enterprise.manage_roles
enterprise.manage_billing
project.create
project.edit
project.view
project.delete
point_map.use
export.advanced
order.view
```

### 3.7 role_permissions

保存角色和权限点关系。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| role_id | uuid / bigint | 是 | 角色 ID |
| permission_code | varchar | 是 | 权限编码 |

约束：

- role_id + permission_code 唯一。

### 3.8 plans

保存套餐配置。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 套餐 ID |
| plan_code | enum | 是 | FREE / PERSONAL_PRO_MONTHLY / PERSONAL_PRO_YEARLY / ENTERPRISE_MONTHLY / ENTERPRISE_YEARLY / ENTERPRISE_CUSTOM |
| name | varchar | 是 | 套餐名称 |
| billing_cycle | enum | 是 | free / monthly / yearly / custom |
| price_cents | integer | 是 | 价格，单位分 |
| currency | varchar | 是 | CNY |
| limits | json | 是 | 套餐限制 |
| is_active | boolean | 是 | 是否上架 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

limits 建议结构：

```json
{
  "max_projects": 1,
  "max_members": 1,
  "can_use_point_map": false,
  "can_create_team": false,
  "can_create_sub_accounts": false,
  "can_use_advanced_export": false,
  "storage_limit_mb": 100,
  "support_level": "standard"
}
```

### 3.9 subscriptions

保存当前订阅状态。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 订阅 ID |
| subject_type | enum | 是 | user / organization |
| subject_id | uuid / bigint | 是 | user_id 或 organization_id |
| plan_id | uuid / bigint | 是 | 套餐 ID |
| status | enum | 是 | free / active / grace_period / past_due / expired / canceled |
| starts_at | datetime | 否 | 开始时间 |
| ends_at | datetime | 否 | 到期时间 |
| canceled_at | datetime | 否 | 取消时间 |
| grace_ends_at | datetime | 否 | 宽限期结束时间 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- subject_type + subject_id 同一时间只能有一个当前有效订阅。
- 个人套餐 subject_type 为 user。
- 企业套餐 subject_type 为 organization。

### 3.10 projects

保存项目。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 项目 ID |
| owner_type | enum | 是 | user / organization |
| owner_id | uuid / bigint | 是 | 用户 ID 或企业 ID |
| name | varchar | 是 | 项目名称 |
| status | enum | 是 | active / archived / deleted |
| created_by_user_id | uuid / bigint | 是 | 创建人 |
| transferred_from_user_id | uuid / bigint | 否 | 数据转移来源用户 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- 免费版项目数量只统计 active 项目。
- archived 项目恢复 active 时必须重新检查套餐额度。

### 3.11 point_maps

保存点位图数据。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 点位图 ID |
| project_id | uuid / bigint | 是 | 项目 ID |
| data | json | 是 | 点位数据 |
| status | enum | 是 | active / locked / deleted |
| created_by_user_id | uuid / bigint | 是 | 创建人 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

约束：

- 访问和编辑点位图必须检查 `point_map.use` 和套餐限制。
- 降级后数据保留，可进入 locked 状态。

### 3.12 orders

保存订单。

| 字段 | 类型建议 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | uuid / bigint | 是 | 订单 ID |
| subject_type | enum | 是 | user / organization |
| subject_id | uuid / bigint | 是 | 付款主体 |
| plan_id | uuid / bigint | 是 | 套餐 ID |
| amount_cents | integer | 是 | 金额，单位分 |
| currency | varchar | 是 | CNY |
| status | enum | 是 | pending / paid / failed / refunded / canceled |
| paid_at | datetime | 否 | 支付时间 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

## 4. 服务模块

### 4.1 AccountService

职责：

- 创建账号档案
- 查询账号类型和状态
- 禁用、恢复、删除账号
- 超级管理员修改账号套餐和状态

关键方法：

```text
getAccountContext(user_id)
setAccountType(user_id, account_type)
disableAccount(user_id)
restoreAccount(user_id)
```

### 4.2 SubscriptionService

职责：

- 查询用户或企业当前套餐
- 判断订阅状态
- 处理升级、续费、取消和过期
- 计算套餐限制

关键方法：

```text
getCurrentSubscription(subject_type, subject_id)
getPlanLimits(subject_type, subject_id)
upgradeToPlan(subject_type, subject_id, plan_code)
markPastDue(subscription_id)
enterGracePeriod(subscription_id)
expireSubscription(subscription_id)
```

### 4.3 OrganizationService

职责：

- 创建企业组织
- 邀请和管理企业成员
- 设置企业主账号
- 移除成员并处理数据转移

关键方法：

```text
createOrganization(owner_user_id, name)
inviteMember(organization_id, email_or_phone, role_id)
disableMember(member_id)
removeMember(member_id, transfer_to_user_id)
```

### 4.4 PermissionService

职责：

- 服务端统一权限判断
- 返回允许或拒绝原因
- 解析账号类型、订阅、套餐、企业成员和角色权限

关键方法：

```text
can(user_id, permission_code, resource)
assertCan(user_id, permission_code, resource)
getDenialReason(user_id, permission_code, resource)
```

### 4.5 ProjectService

职责：

- 创建、编辑、归档、删除项目
- 执行项目数量限制
- 管理个人项目和企业项目归属

关键方法：

```text
createProject(user_id, owner_type, owner_id, payload)
archiveProject(user_id, project_id)
restoreProject(user_id, project_id)
transferProject(project_id, target_owner_type, target_owner_id)
```

### 4.6 PointMapService

职责：

- 创建和编辑点位图
- 降级后锁定点位图
- 校验点位图权限

关键方法：

```text
getPointMap(user_id, project_id)
savePointMap(user_id, project_id, data)
lockPointMapsByProject(project_id)
unlockPointMapsByProject(project_id)
```

## 5. 权限判断伪代码

```text
function can(user_id, permission_code, resource):
  user = loadUser(user_id)
  if user is null:
    return deny(NOT_AUTHENTICATED)

  account = loadAccountProfile(user_id)
  if account.status != active:
    return deny(ACCOUNT_DISABLED)

  if account.account_type == SUPER_ADMIN:
    return allow()

  subscription = resolveSubscription(user_id, resource)
  plan_limits = loadPlanLimits(subscription.plan_id)

  if subscription.status in [expired, past_due]:
    return deny(SUBSCRIPTION_EXPIRED)

  if permission_code == project.create:
    if activeProjectCount(resource.owner) >= plan_limits.max_projects:
      return deny(PROJECT_LIMIT_REACHED)

  if permission_code == point_map.use:
    if plan_limits.can_use_point_map == false:
      return deny(POINT_MAP_NOT_INCLUDED)

  if permission_code starts with enterprise:
    if plan_limits.can_create_team == false:
      return deny(TEAM_FEATURE_REQUIRED)

  if resource belongs to organization:
    member = loadOrganizationMember(resource.organization_id, user_id)
    if member is null or member.status != active:
      return deny(RESOURCE_NOT_FOUND_OR_NOT_OWNED)
    if roleDoesNotHavePermission(member.role_id, permission_code):
      return deny(ROLE_PERMISSION_DENIED)

  if resource belongs to personal user and resource.owner_id != user_id:
    return deny(RESOURCE_NOT_FOUND_OR_NOT_OWNED)

  return allow()
```

## 6. API 清单

### 6.1 账号与当前用户

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | /api/me | 获取当前用户、账号类型、订阅、权限摘要 | 登录用户 |
| PATCH | /api/me/profile | 更新个人资料 | 登录用户 |
| GET | /api/admin/accounts | 超级管理员查看账号列表 | account.manage_all |
| PATCH | /api/admin/accounts/{user_id} | 超级管理员修改账号状态或套餐 | account.manage_all |

### 6.2 项目

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | /api/projects | 项目列表 | project.view |
| POST | /api/projects | 创建项目 | project.create |
| PATCH | /api/projects/{project_id} | 编辑项目 | project.edit |
| POST | /api/projects/{project_id}/archive | 归档项目 | project.edit |
| POST | /api/projects/{project_id}/restore | 恢复项目 | project.edit + 套餐额度 |
| DELETE | /api/projects/{project_id} | 删除项目 | project.delete |

### 6.3 点位图

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | /api/projects/{project_id}/point-map | 查看点位图 | point_map.use |
| PUT | /api/projects/{project_id}/point-map | 保存点位图 | point_map.use + project.edit |

### 6.4 企业组织和成员

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | /api/organizations | 创建企业组织 | TEAM_FEATURE_REQUIRED 通过后 |
| GET | /api/organizations/current | 获取当前企业 | 企业成员 |
| GET | /api/organizations/current/members | 成员列表 | enterprise.manage_members |
| POST | /api/organizations/current/members | 邀请或创建成员 | enterprise.manage_members |
| PATCH | /api/organizations/current/members/{member_id} | 修改成员角色或状态 | enterprise.manage_members |
| DELETE | /api/organizations/current/members/{member_id} | 移除成员 | enterprise.manage_members |
| GET | /api/organizations/current/roles | 角色列表 | enterprise.manage_roles |
| PATCH | /api/organizations/current/roles/{role_id} | 修改角色权限 | enterprise.manage_roles |

### 6.5 套餐、订阅和订单

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | /api/plans | 获取可购买套餐 | 登录用户 |
| GET | /api/subscription | 当前订阅 | 登录用户 |
| POST | /api/subscription/upgrade | 升级套餐 | 登录用户 |
| POST | /api/subscription/cancel | 取消续订 | 订阅所有者 |
| GET | /api/orders | 订单列表 | order.view |
| GET | /api/admin/orders | 平台订单列表 | account.manage_all |

## 7. 页面模块

### 7.1 个人账号中心

模块：

- 我的项目
- 当前套餐
- 升级付费
- 订单记录
- 个人资料

关键状态：

- 免费版显示项目额度 1 个。
- 免费版点位图入口展示锁定状态和升级提示。
- 个人升级版展示到期时间和续费入口。

### 7.2 企业管理后台

模块：

- 企业资料
- 团队成员
- 角色权限
- 企业项目
- 订阅与订单
- 发票信息
- 使用统计

关键状态：

- 只有企业主账号和被授权管理员可进入成员管理。
- 财务角色只能查看订单、发票和订阅信息。
- 企业过期时，后台展示续费提示和只读状态。

### 7.3 超级管理员后台

模块：

- 账号管理
- 企业管理
- 套餐管理
- 订单管理
- 平台功能开关
- 数据统计
- 操作日志

关键状态：

- 所有账号操作必须写入操作日志。
- 修改套餐、到期时间、账号状态需要二次确认。

## 8. 测试用例清单

### 8.1 免费版

- 免费账号可以创建第 1 个项目。
- 免费账号创建第 2 个项目失败，返回 PROJECT_LIMIT_REACHED。
- 免费账号访问点位图失败，返回 POINT_MAP_NOT_INCLUDED。
- 免费账号点击团队功能，返回 TEAM_FEATURE_REQUIRED。

### 8.2 个人升级版

- 个人升级版可以创建多个项目。
- 个人升级版可以使用点位图。
- 个人升级版邀请成员失败，返回 TEAM_FEATURE_REQUIRED。
- 个人升级版降级后保留项目，但超额项目只读或归档。

### 8.3 企业版

- 企业主账号可以邀请成员。
- 企业主账号可以修改子账号角色。
- 企业子账号只能访问授权项目。
- 企业子账号无角色权限时返回 ROLE_PERMISSION_DENIED。
- 企业成员被移除后不能访问原企业项目。
- 企业主账号移除子账号时必须选择数据接收人。

### 8.4 超级管理员

- 超级管理员可以查看所有账号。
- 超级管理员可以修改用户套餐。
- 超级管理员可以禁用和恢复账号。
- 普通用户访问超级管理员接口返回 PLATFORM_ADMIN_REQUIRED。

### 8.5 订阅状态

- ACTIVE 状态按套餐权益开放功能。
- GRACE_PERIOD 状态可查看数据但不可新增或编辑。
- PAST_DUE 状态展示支付重试。
- EXPIRED 状态锁定付费功能。
- CANCELED 状态在到期前仍保持权益。

## 9. 推荐开发顺序

1. 创建枚举和基础表：users、account_profiles、plans、subscriptions。
2. 初始化套餐和权限点数据。
3. 实现 PermissionService 的 `can` 和 `assertCan`。
4. 实现项目创建限制。
5. 实现点位图权限限制。
6. 实现个人升级版订阅。
7. 实现企业组织、成员、角色和权限。
8. 实现企业版订阅和成员数量限制。
9. 实现超级管理员后台接口。
10. 实现订单、发票、操作日志和统计。

## 10. 待确认事项

- 宽限期具体天数。
- 支付渠道。
- 发票类型和开票流程。
- 个人升级版剩余时长抵扣公式。
- 企业成员超额后的访问策略。
- 企业高级版是否包含私有化部署。
- 多企业组织成员关系是否进入 v1。
