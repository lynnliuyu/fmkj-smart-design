# 项目文档索引

## 阅读顺序

1. `core-business-flow.md`
   - 核心业务主流程
   - 项目详情工作台规划
   - 报价、合同、工单、交付、售后关系
   - 主导航收口规则

2. `account-tier-and-upgrade-plan.md`
   - 产品规格
   - 账号等级
   - 套餐设计
   - 验收标准
   - 数据模型建议
   - 权限判断流程
   - 订阅和升级规则

3. `account-system-technical-spec.md`
   - 技术实现规格
   - 数据表设计
   - 服务模块
   - 权限伪代码
   - API 清单
   - 页面模块
   - 测试用例

4. `account-system-development-roadmap.md`
   - 开发路线图
   - 里程碑拆分
   - 前后端任务
   - 测试验收
   - 风险处理

5. `account-system-m6-status.md`
   - M6 管理后台和运营能力完成状态
   - 已完成接口和页面入口
   - 剩余风险和验证命令

6. `local-database.md`
   - 本机 Docker Postgres 的启动、连接串和常用命令
   - 迁移链执行顺序
   - 数据库连接工具配置

7. `deployment-docker.md`
   - 生产环境 Docker 部署
   - 1Panel 反向代理

## 当前状态

账号体系 M6 主干已经收口，详情见 `account-system-m6-status.md`。

工作流梳理与精简的范围、结果和验收证据见 [Plan 021](../plans/021-workbench-workflow-consolidation.md)。已确定的报价规则见 [ADR 0006](adr/0006-project-quotation-defaults-and-linked-deletion.md)，固定版本客户出口及编辑职责见 [ADR 0007](adr/0007-fixed-delivery-outputs-and-editor-responsibilities.md)。领域规则仍以 `CONTEXT.md` 和相关 ADR 为准。

DWG 输入先做[原图逐页对照](cadcraft-point-map-bridge.md#dwg-原图逐页对照先于净底)，确认采用的方案后才提取净底。使用 `pnpm run cad:review` 生成本地对照包，保留未识别区域的总览和空视口警告；实施记录见 [Plan 022](../plans/022-dwg-source-review.md)。

当前验证命令：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm run doctor # 仓库配置与端口诊断；pnpm doctor 为 pnpm 自带环境检查
pnpm db:up       # 本地数据库首次启动
pnpm db:migrate
pnpm db:smoke
```

## 产品选型实施

- [产品采集与入库代理说明](product-catalog-agent-guide.md)：交给采集代理的执行步骤、字段、证据、去重与入库验收，附采集模板。
- [产品库与点位映射](product-point-mapping-plan.md)：类型、规格、兼容与历史快照合同。
- [Plan 020](../plans/020-product-point-mapping.md)：执行阶段与验收。

## 点位与方案交付

- [点位图、商品圆图与方案导出工作流](point-map-visual-presentation-workflow.md)：生成最新版、素材图库、圆图微调、场景关联、缓存和历史版本。
- [ADR 0005](adr/0005-project-delivery-and-reusable-visuals.md)：完整交付版本与素材复用边界。
- [ADR 0007](adr/0007-fixed-delivery-outputs-and-editor-responsibilities.md)：三段工作台入口、保存确认、草稿检查与固定版本出口。

本机图片存储、布局 / 灯光 / 开关图切换及配准规则见 [ADR 0009](adr/0009-local-image-storage-and-reference-drawings.md) 与 [Plan 027](../plans/027-local-image-storage-and-reference-drawings.md)；实际操作见 [点位设计工作流](point-map-design-workflow.md)。
