# Issue Tracker：GitHub

本仓库的需求、缺陷和 PRD 统一放在 GitHub Issues，仓库为 `lynnliuyu/fmkj-smart-design`（fork 后使用当前仓库上下文）。涉及 issue 的操作优先使用 `gh` CLI。

## 操作约定

- 创建 issue：`gh issue create --title "..." --body "..."`
- 查看 issue：`gh issue view <number> --comments`
- 列出 issue：`gh issue list --state open --json number,title,body,labels,comments`
- 评论 issue：`gh issue comment <number> --body "..."`
- 添加标签：`gh issue edit <number> --add-label "..."`
- 移除标签：`gh issue edit <number> --remove-label "..."`
- 关闭 issue：`gh issue close <number> --comment "..."`

在仓库目录内运行这些命令，让 `gh` 根据 `git remote -v` 自动识别 GitHub 仓库。

## PR 是否作为 triage 入口

外部 PR 不作为本仓库的 triage 请求入口。

当 skill 要求“发布到 issue tracker”时，创建 GitHub Issue。

当 skill 要求“读取相关 ticket”时，运行：

```bash
gh issue view <number> --comments
```
