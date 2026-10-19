# Agent 使用说明

## Agent skills

### Issue tracker

本仓库使用 GitHub Issues 跟踪需求、缺陷和 PRD，仓库为 `lynnliuyu/fmkj-smart-design`（fork 后使用当前仓库上下文）；外部 PR 不作为 triage 请求入口。详见 `docs/agents/issue-tracker.md`。

### Triage labels

本仓库使用默认 triage 标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库使用 single-context 领域文档结构：根目录 `CONTEXT.md` 加 `docs/adr/` 下的 ADR。详见 `docs/agents/domain.md`。

### 产品采集与入库

收集产品、整理旧产品或新增具体 SKU 时，先读 `docs/product-catalog-agent-guide.md`，按现有字段、证据和业务写入入口操作。

### 点位、报价与客户交付

变更这条工作流前，读 `CONTEXT.md`、相关 ADR（尤其 0005—0007）和 `plans/021-workbench-workflow-consolidation.md`。默认型号允许作明确标识的未核验客户报价；项目换型不改全局；删除来源报价行联动删点位与场景引用。不要根据旧测试或初始架构建议反转这些用户决定。

操作说明分别维护在 `docs/point-map-design-workflow.md` 与 `docs/point-map-visual-presentation-workflow.md`。客户出口使用固定交付版本，草稿检查图不作为历史整套方案。复用现有预览与交付 module，不重新添加客户端采购计算或另一套导出来源。交接必须区分本机预览、数据库已保存、固定版本与实际导出验证；不能以测试通过声称客户项目已完成。
