# 026 默认窗帘报价同步与失败重试

Status: DONE
Date: 2026-10-15

用户反馈底图替换后报价没有同步。按 diagnosing-bugs 流程读取实际数据库 r4 的共享预览：29 点可报价、4 点阻塞，全部为 BT-C01—C04 的“窗帘电机的轨道及配套材料尚未展开”。这与 ADR 0006 允许默认型号进入未核验客户报价的决定不一致；不是图片迁移失败。

## 修复与边界

- 默认型号预览将未知配套数量 / 单位和未选型号列为未报范围，保存到 quotationVerification 的原因中；设备本体照常报价，未知米数 / 配件不生成虚构行。统一核验标识把未报范围直接显示，覆盖报价编辑页、报价 PDF、方案 PDF 和 CSV，不能仅悬停可见。
- 已选配套 SKU 不可用、格式无效、单位 / 套装已含 / 实体冲突继续阻塞。明确选择后的采购路径不放宽。用有效默认主型号展开配套，避免推断设备类型或套装信息丢失。
- 点位“保存草稿”即使来源没改也重试共享报价刷新；移除跳过分支，不新增按钮、报价计算器或另一套写入入口。生成本机预览后仍由现有报价保存接口校验并入库。

## 复现与验证

`pnpm exec vitest run tests/point-map-default-products.test.ts` 在修复前 2 个回归失败：四个默认窗帘使 refreshPointMapQuote 返回 updated=false；未知轨道长度使 blocked=true。修复后通过，同时断言不虚构用料、未报范围可见、正式采购及冲突仍阻塞、原方案不变。

真实数据库同一 r4 预览从 blocked=true / included=29 变成 blocked=false / included=33，33 点全为未核验，procurementReady=false；未改数据库点位以规避规则。随后在用户已登录的真实工作台再次保存未改动方案至 r5，页面确认本机预览 33 台，证明无编辑保存也能重试。进入报价页并保存成功，数据库读回 QT-EXAMPLE-DEMO：¥13,641，22 行 / 33 台 / 33 个来源点位，全部 revision=5、全部未核验，四行保留“配套未计入本次报价”原因。未更改全局默认、原图位置、设计状态和场景，未创建确认版或固定交付版。

80 文件 / 843 测试、typecheck、相关 ESLint、git diff --check 通过。未执行生产构建，也未声称已实际导出两类 PDF；其未报范围显示复用既有共享标签函数。

实际诊断、修复后预览与保存读回指标位于忽略目录 `.local/bangtai-jinghe/compact-v3/` 的 `quote-preview-diagnostics-r4.json`、`quote-preview-after-fix-r4.json`、`saved-quote-r5.json`。r4 替换原稿备份继续保留。
