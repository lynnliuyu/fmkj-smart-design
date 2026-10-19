# 参与贡献

感谢提交问题与改进。先阅读 [README](README.md) 完成本机依赖、数据库迁移和管理员初始化，再阅读 [CONTEXT.md](CONTEXT.md)、[AGENTS.md](AGENTS.md) 与相关 ADR。

## 问题与需求

在当前仓库的 GitHub Issues 使用缺陷或功能模板，提供最小复现、预期/实际结果、运行版本和脱敏日志。需求与 PRD 先建 Issue；外部 PR 不替代 triage。不要上传客户图纸、价格表、合同、个人信息或环境密钥。安全漏洞按 [SECURITY.md](SECURITY.md) 私下报告。

## 修改与验证

从当前主分支创建 `codex/简短说明` 或你自己的主题分支，保持每个 PR 聚焦一件事。遵循现有 TypeScript、React 和格式约定；不引入无关重构或重新格式化。新增迁移，避免修改已记账的迁移 SQL。

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
```

根据影响范围补充有效测试。涉及数据库、浏览器或导出时，说明实际验证的环境和结果，区分预览、数据库已保存、固定版本与实际导出；未做的验收明确写出。PR 描述交代问题、修改后的行为和验证证据；不要包含客户截图或凭据。

点位、报价和交付变更遵循 [Plan 021](plans/021-workbench-workflow-consolidation.md) 与相关 ADR；产品资料按[采集指南](docs/product-catalog-agent-guide.md)，提供可核查来源和合法图片。

## 使用 Claude Code

先读 [CLAUDE.md](CLAUDE.md) 与 AGENTS.md，按需读领域文档。助手不得把示例、旧计划或测试当作推翻明确业务决定的授权。向外部服务提交内容前自行确认授权，避免向模型或日志泄露凭据和客户信息。

贡献者应拥有所提交代码或素材的授权，并接受其项目代码贡献按 GPL-3.0-only 发布。第三方代码必须保留原许可证与版权声明；品牌商标不因代码贡献获得授权。
