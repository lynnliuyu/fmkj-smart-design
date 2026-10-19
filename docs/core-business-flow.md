# Core Business Flow

This document records the product and architecture decisions for FMKJ V3 after the first round of feature build-out. Future AI tasks should use this as the default business context before adding pages, APIs, or data models.

## Product Positioning

FMKJ V3 is a project-centered workflow system for smart home and whole-house intelligent installation projects.

The system should optimize for one main operating flow:

1. Create a project.
2. Enter minimal customer and property information.
3. Build a solution quote（方案报价），把点位规划、设备选择和报价版本放在一条流程里。
4. Generate versioned quote documents.
5. Confirm a quote and generate a contract.
6. Create work orders for execution.
7. Complete delivery confirmation.
8. Track aftercare.

The product should feel simple and operational. Avoid repeating the same data across multiple panels or pages.

项目主列表应当像每日运营工作台。项目优先级必须来自结构化字段，而不是从展示文案里猜：

- 风险或阻塞项目
- 下一步今天或近期到期的项目
- 等待客户、内部团队或供应商的项目
- 普通进行中项目

## Main Project Flow

The canonical flow is:

```text
New Project
-> Basic Info
-> Solution Quote / 方案报价
-> Point Planning / 点位规划
-> Equipment List / 设备清单
-> Quote Version
-> Quote PDF
-> Contract PDF
-> Work Orders
-> Delivery Confirmation
-> Aftercare
```

The project is the main container. Point maps, quotes, contracts, work orders, delivery confirmations, and aftercare records should all be understood in relation to a project.

## Project Creation

New project creation should ask for as little information as possible:

- Customer name
- Phone number
- Community / estate name, with future autocomplete support
- Building
- Unit
- Room number

Information that can be added later:

- Flat / villa type
- Project owner
- More detailed customer profile
- Full address metadata

The default project owner should be the creator.

## Project Workspace

The project detail page should become the primary workbench for business execution.

2026-10-15 收口：单个项目的设计操作通过“点位设计 → 报价单 → 客户交付”三个入口连续进行；每页只保存自己的资料，客户文件统一使用固定 V 版本。项目详情默认显示资料和方案报价，合同、工单、安装验收、售后、成员及现场图片集中在“执行与资料”，原有直达链接和业务实现保留。默认型号的未核验客户报价与来源报价删除联动，遵循 ADR 0006；保存、版本和出口职责遵循 ADR 0007。以下生命周期内容继续描述安装业务，不把“完整交付版本”当作安装后的“交付验收”。

项目详情第一屏应当像项目指挥台：

- 当前阶段
- 下一步动作
- 负责人
- 截止时间
- 等待对象
- 风险原因
- 当前阶段的主操作

Recommended project workspace tabs:

- Basic info
- Solution quote / 方案报价
- Contract
- Work orders
- Delivery
- Aftercare

Standalone pages can exist for global search and review, but deep editing should happen in the project workspace.

## Standalone Lists And Previews

Contracts, work orders, and aftercare records may have standalone entry points for operational convenience.

Standalone pages should provide:

- List view
- Search and filtering
- Preview drawer or preview page
- Quick status actions where appropriate

Deep editing should navigate back to the related project workspace.

Rules:

- Contracts should belong to a project.
- Work orders should belong to a project.
- Aftercare can be created manually for now, but should capture enough customer and property information to be linked to a project later.

## Quotes

报价必须保留版本，并且应当归入“方案报价”工作流。

方案报价工作流包含：

1. 点位规划。
2. 设备/产品清单。
3. 报价版本。
4. 客户确认。

Recommended quote statuses:

```text
Draft -> Sent -> Customer Confirmed -> Contract Generated
```

Rules:

- Major quote changes should create a new version rather than overwrite the old one.
- A customer confirms one specific quote version.
- Only a confirmed quote version can generate a contract.
- Quote PDF export should include the point map when the project has one.
- Quote UI should show only necessary project summary data, not duplicate the entire project profile.
- 点位规划和报价版本应当是一条连续工作流，而不是两个割裂的侧边栏模块。

## Contracts

Contracts should be generated from confirmed quote versions.

Rules:

- A project normally has one current confirmed contract.
- Historical contract versions may be retained.
- Contract PDF export should include:
  - Contract body
  - Confirmed quote
  - Point map attachment when available
- Contract list previews should show customer, project, quote summary, PDF status, and signing status.
- Editing contract details should happen from the project workspace.

## Work Orders

Work orders are project execution records.

Basic fields:

- Type, such as installation, commissioning, repair, revisit, add-on, rectification, delivery preparation
- Standard work content tags
- Related products selected from the confirmed quote
- Status
- Site photos
- Notes

Recommended statuses:

```text
Pending Schedule -> In Progress -> Pending Acceptance -> Completed
```

Enterprise-only fields:

- Construction owner
- Workers
- Labor price / piece rate / settlement amount
- Internal cost notes
- Acceptance record

The basic version should stay lightweight. Enterprise accounts can unlock labor pricing and settlement fields.

## Delivery Confirmation

Delivery confirmation should start with a fixed template plus a small number of custom items.

Recommended sections:

- Customer information confirmed
- Products and quantities confirmed
- Installation locations confirmed
- Power, network, and device control tested
- Scenes and automations tested
- Usage instructions delivered
- Warranty and aftercare explained
- Customer signature or online confirmation
- Site photo attachments

The delivery record should support both:

- Online checklist confirmation
- Printable confirmation form that can be signed and uploaded

## Aftercare

Aftercare is currently created by internal users.

Future owner-side functionality can extend this area, but for now aftercare should support:

- Manual ticket creation
- Customer and property information
- Optional project link
- Issue type and description
- Processing notes
- Status tracking
- Attachments where useful

## Project Status

Project status should be the main progress axis.

Recommended statuses:

```text
Needs Info
-> Planning / Quoting
-> Waiting Customer Confirmation
-> Contracting
-> Construction
-> Pending Delivery
-> Delivered
-> In Aftercare
```

Rules:

- New projects start as `Needs Info`.
- Starting point map or quote work moves the project to `Planning / Quoting`.
- Sending a quote moves the project to `Waiting Customer Confirmation`.
- Confirming a quote and generating a contract moves the project to `Contracting`.
- Active work orders move the project to `Construction`.
- Completed work orders move the project to `Pending Delivery`.
- Confirmed delivery moves the project to `Delivered`.
- Open aftercare can temporarily show the project as `In Aftercare`.

## Navigation Rules

Primary navigation should focus on daily business operations:

- Projects
- Work orders
- Contracts
- Aftercare
- Product library
- Admin / Management

Secondary or merged navigation:

- 方案报价可以作为设计/报价人员的全局队列存在，但项目详情仍然是继续单个项目点位和报价工作的主入口。
- 报价主要归入方案报价。只有在支持真实跨项目复核时，全局报价页才应保留为查询列表。
- 点位图主要归入方案报价。
- Users, settings, and account system should move under admin or account menus.
- Showcase, demo, and duplicate marketing pages should be removed or hidden if they are not real business entry points.
- Tasks should be merged into work orders if work orders replace their purpose.

## UI Principles

- Keep pages simple and operational.
- Do not show the same customer, project, quote, or status information repeatedly on one page.
- Prefer one clear primary action per stage.
- Use previews for global lists and reserve full editing for project workspace pages.
- Avoid decorative dashboards that do not help daily work.
- Keep management/admin functionality available but visually secondary to the main business flow.

## Implementation Phases

Phase 1: Business flow consolidation

- Build the project detail workspace skeleton.
- Simplify project creation.
- Move point map, quote, contract, work order, delivery, and aftercare entry points into the project workspace.
- Keep standalone contract, work order, and aftercare pages as list and preview surfaces.
- Clean up sidebar navigation.

Phase 2: Code reduction and cleanup

- Remove or hide demo pages.
- Merge duplicated fallback/demo data.
- Merge or retire tasks if work orders replace them.
- Extract shared project/customer summary components.
- Consolidate overlapping APIs.
- Keep this document updated as the business flow changes.
