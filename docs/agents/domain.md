# 领域文档

本仓库使用 single-context 领域文档结构。

## 探索代码前优先阅读

工程类 skills 在分析、规划或实现前，应按需阅读：

- 根目录 `CONTEXT.md`
- `docs/adr/` 下相关 ADR

如果已有 ADR 或领域词汇与新方案冲突，需要明确指出冲突，而不是静默覆盖。

## 文档布局

```text
/
├── CONTEXT.md
├── docs/adr/
└── app, components, lib, scripts
```

## 词汇规则

写 issue、计划、测试、服务名和界面概念时，优先使用 `CONTEXT.md` 中定义的领域词汇。如果缺少某个概念，记录为后续 domain-modeling 候选项，不要随意创造同义词。
