# Plan 031：设计站导入 CAD 生成点位（对接托管接口）

Status: DONE
Started: 2026-10-21

## 用户要求

提供两类对接：一是直接面向客户的图纸导出（已完成，见 [CAD 导出接口](../docs/cad-export-api.md)）；二是把繁梦空间设计站对接到托管接口——建项目后导入 CAD 文件，自动生成对应点位。最终形态是客户自行部署设计站，通过配置对接我方接口。

## 边界与既有实现

- 已实现（复用，不重写）：图框识别与逐页导出（`export-cad-review.mjs`）、净底提取（`prepare-cad-floorplan.mjs`）、同坐标参考图（`prepare-cad-reference-drawings.mjs`）、点位 CAD 往返（`cadcraft-point-map.mjs`、`lib/point-map-cad-contract.ts`）、设计站草稿导入（`lib/point-map-design.ts` 的 `importPointMapDraft`）。
- 已实现（部署方向）：[ADR 0010](../docs/adr/0010-hosted-local-deployment-and-optional-catalog.md) 与 [Plan 028](028-hosted-local-and-catalog-foundation.md) 确定线上托管与本地设备共用一套业务核心。本计划只新增“CAD → 点位”这条数据通道，不改业务核心与产品库边界。
- 本次新增：托管侧 CAD 解析接口 + 设计站侧客户端/路由/入口。此前“生成点位草稿”由助手人工完成（见 [Plan 016](016-assisted-point-map-design-workflow.md)），本计划把它变成可对接的服务。

## 两类接口的分工

| | A：面向客户 | B：面向设计站 |
| --- | --- | --- |
| 端点 | `POST /v1/exports` | `POST /v1/cad-imports` |
| 用途 | 上传 DWG，取得逐页 PDF / PNG 审阅资料 | 上传 DWG，取得底图 + 灯具/开关参考图 + 点位草稿 |
| 输出 | 图纸页文件与合并 PDF | `fmkj-point-map-draft` 草稿 + 底图 PNG + 参考图 + 来源指纹 |
| 调用方 | 客户本人或我方前端 | 客户自部署的设计站服务端 |
| 是否需 AI | 否 | 否（规则提取；不能确定的一律标待复核） |

两侧共用同一份 CAD 解码与渲染链路，令牌只在服务端之间传递，不进入浏览器。

## 点位提取规则（可核对、可解释）

点位来源限定为 CAD 中**可命名的图块**，不猜测自由线条：

1. 读取目标布局/图框范围内的 INSERT 图块，取块名、所在图层、插入点（世界坐标）。
2. 归类型：按块名与图层关键词映射到 `lib/point-device-symbols.mjs` 的 44 个 iconId（如 `筒灯→downlight`、`射灯→spotlight`、`灯带→light-strip`、`开关→switch-1`、`插座→socket`、`AP→ap`、`摄像头→camera`）。
3. 坐标换算：`cadPercentPosition(cadX, cadY, window, imageWidth, imageHeight)`，Y 轴翻转与设计站一致（`lib/point-map-crop-geometry.mjs` 同源公式）。
4. 只输出有把握的点位；命中同一图块多次、无法归类型、或落在图框外的候选写入 `reviewNotes`，状态为 `planned` + `confidence: low`，由用户在编辑器复核。
5. 每个点位带 `source: "analysis"`、`code`（如 `L-001`）、`reviewReason`，不自动置为已确认。

## 草稿契约

沿用设计站既有草稿信封，保证可用 `parsePointMapDraft` 直接校验：

```json
{
  "format": "fmkj-point-map-draft",
  "version": 1,
  "coordinateSystem": "image-percent",
  "floors": [{ "id": "...", "name": "...", "floorplanName": "...", "floorplanDataUrl": "data:image/png;base64,...", "imageWidth": 3000, "imageHeight": 2121, "sourcePage": "page-024", "cad": { "format": "cadcraft", "version": 1, "drawingId": "...", "drawingSha256": "...", "window": [x0,y0,x1,y1] } }],
  "points": [{ "id": "...", "name": "...", "room": "", "iconId": "downlight", "status": "planned", "x": 41.2, "y": 63.8, "productId": "", "note": "", "placed": false, "floorId": "...", "code": "L-001", "source": "analysis", "confidence": "medium", "reviewReason": "..." }],
  "scenes": []
}
```

跨系统硬约束（必须由测试保证）：`coordinateSystem` 固定 `image-percent`；坐标范围 0–100 且基于实际图片；`iconId` 必须在 `supportedIconIds` 内；`floorId` 必须指向草稿内的楼层；同一文件内 ID 唯一。

## 阶段

| 阶段 | 状态 | 交付物 | 完成依据 |
| --- | --- | --- | --- |
| 031.1 点位提取核心 | DONE（图标细分是已知限制） | `scripts/cadcraft/extract-points.py` + 生成的草稿 JSON | 真实 DWG 提取出点位；草稿通过设计站 `parsePointMapDraft`；坐标与底图一致 |
| 031.2 底图与参考图 | DONE（参考图需叠在底图上用） | `scripts/cadcraft/build-floor.py` | 图像尺寸与 `window` 一致；同坐标叠放可核对 |
| 031.3 托管解析接口 | DONE | `（该脚本不随自部署版发布）` + `scripts/cadcraft/cad-import-worker.mjs` | 真实 DWG 端到端；失败不留半成品；不返回未验证点位 |
| 031.4 设计站客户端与路由 | DONE | `lib/point-map-cad-import.ts`、`lib/cad-import-api.ts`、`app/api/projects/[id]/cad-import/route.ts` | 令牌仅服务端；写库有权限与冲突校验；重复导入不重复建点 |
| 031.5 工作台入口 | DONE（未做浏览器登录态实测） | “从 CAD 导入生成点位”面板 | 用户可看到预摆点位与待复核提示，保存后才写库 |
| 031.6 文档与部署 | DONE（工作台入口未做） | 双侧对接文档、环境变量、客户自部署说明 | 干净实例按文档配置即可对接；不含我方密钥 |

## 不在本计划内

- 自动确认点位、自动出报价、自动生成固定交付版本。
- 无图块依据的自由几何推断、图形识别式“智能布点”。
- 官方产品库同步与订阅（属 Plan 028）。
- 客户图纸上传到任何第三方服务；全部处理在我方托管服务或客户自己实例内完成。

## 验收情景

1. 真实 DWG 经 031.3 导入后，设计站看到带房间与点位编号的预摆点位，位置与底图一致。
2. 无法归类的图块进入待复核清单，不生成假点位；无图块的图纸明确返回“未识别到可提取点位”。
3. 同一图纸重复导入：已有手动编辑不被覆盖，不重复建点。
4. 令牌错误、超时、我方服务不可用时，设计站明确报错且不写库。
5. 客户自部署实例只配置接口地址与令牌即可对接；令牌不出现在浏览器、URL 或日志。

## 031.1 实施记录（2026-10-21）

已落地 `scripts/cadcraft/extract-points.py`：与 `render-clipped-review.py` 共用同一条前端口与页面变换矩阵，先把可见内容录制成 record，再用**同一个** `get_placement_matrix` 换算成页面百分比。因此坐标与被渲染的 PNG 天然一致，不需要另算视口变换。

真实数据（示例项目 `平面图` 的 page-029 灯具定位图 / page-030 开关布置图）验证：

- 图层是分类信号而非块名：该图纸的名字是 `A$C52335EB2` 这类匿名块名，`D-灯具空调`、`D-灯控`、`D-强电`、`00008-06-空调点位` 才区分设备类别。
- 视口冻结自动生效：直接用渲染器录制结果，因此“哪张图显示哪些层”不需要我另判。
- 叠点核验图确认坐标方向正确：圆点落在图上圆形灯位符号上。

**跨系统契约实测踩到 3 个真实不匹配并已修正**（由设计站自己的 `parsePointMapDraft` 判定）：

1. `floors[].sourcePage` 必须是数字（1–100000），不能是 `"page-029"` 字符串。
2. `points[].room` 必须非空文本；CAD 图块无法可靠判断房间，改用 `未分房间` 并在 `reviewReason` 说明，不假装已分房间。
3. `imageWidth/imageHeight` 必须报 PNG **真实像素**；fitz 按 72dpi 折算会报成 2250×1590，虽然百分比不变但会给设计站错误画布尺寸。

已把这些约束固化为 `tests/point-map-cad-import-contract.test.ts`（4 项）。

### 精度修正（第二轮）

初版两页提取 655 个点，逐项定位后修正为 **72 个**（灯具 52、开关 20），并逐项验证：

| 缺陷 | 根因 | 修正 |
| --- | --- | --- |
| 同一符号被拆成多个点 | 按 record 逐条取中心，一个符号的外框/内芯是多条记录 | 先按实体 handle 合并记录，一个图块一个点 |
| 同心重复点残留 | 单遍贪心聚类、顺序相关 | 改为并查集合并，半径 0.45% |
| 灯具页与开关页结果完全相同 | ezdxf 前端口**不按视口冻结图层过滤**，两页都画了全部图层 | 用 job 里的 `viewports[].frozenLayers` 主动排除 |
| 开关页重复产出灯具点位 | 开关图通常同时画灯具作参考 | 按**图名**收敛类别（灯具图→灯具、开关图→开关、插座图→插座、给排水→不产出） |
| 标注图层被当成设备 | `D-灯具空调结构线` 等辅助层含“灯”字 | 增加标注类负向词（结构线/标注/尺寸/引线/索引…） |

核验证据（`.local/cad-export-api-qa/perf/extract-lighting/`）：

- `overlay-page-029.png` 放大核对：红圈与图上灯位符号一一对应，序号连续，**没有同心重复**；图例说明表格内的符号**没有被误收**。
- 最近邻距离：灯具页 p10 = 2.56%，无小于 0.6% 的点对，说明没有残留重复。
- 草稿通过设计站 `parsePointMapDraft`：2 层 / 72 点 / 底图 3000×2121 内嵌 / `sourcePage` 数字。

**已知限制（不掩饰）**：图标只按图层给到类别默认值（灯具一律 `downlight`、开关一律 `switch-1`）。这份图纸的块名是 `A$C52335EB2` 这类匿名名，无法据此细分射灯/吊灯/灯带；细分需要人工确认或后续按图块几何特征做，不能凭图层猜。

## 031.2 实施记录（第二、三轮）

决策：**一层 = 一张模型窗口底图 + 灯光/开关/插座参考图**，而不是“一张图纸页一层”。理由：同一层的灯具图、开关图、插座图纸面位置各不相同，但模型窗口相同；只有以窗口为基准，底图、参考图、点位坐标才能严格对齐。该决定与项目已有 `references` / “导入已配准图纸包”一致。

新增 `scripts/cadcraft/build-floor.py`：按 `--floor 名称=页号[,页号...]` 取窗口，一次产出 `base.png`、`ref-lighting.png`、`ref-switch.png`、`ref-socket.png`、`draft.json`、`overlay.png`、`floor.json`。与导出器共用同一 `layout` / 矩阵代码。

真实图纸（示例项目，窗口取自 page-029 视口）实测：

- 几何对齐：底图 3000×2121，参考图同尺寸；叠点图上红圈落在灯位上，坐标一致。
- 点位：46 灯 + 15 开关；插座页 `D-强电` 在窗口内**没有图块**（插座是用线条画的），系统如实报“无可提取图块”，不编造点位。
- 断言：`draft.json` 仍通过设计站 `parsePointMapDraft`。

**图面质量不达标（031.2 未完成）**：

1. **底图把全部图层都画进来了**：彩色标注、吊顶网格填充、尺寸与文字都在，不能直接当点位底图。
2. **参考图只有灯具符号与连线、没有墙体**，人工无法单独核对，只能叠在底图上用。
3. 未做白底黑线的统一配色，也未去掉栅格填充（`HATCH` 面积大，渲染也慢）。

修法（下一轮）：底图改为复用已验证的净底流程 `prepare-cad-floorplan.mjs`（CADCraft `wblock` 取窗口 + 清理文字/尺寸/栅格 + 统一 `FMKJ_BASE` 黑线），参考图保留结构层 + 单类设备层；或者在我方渲染里加“结构层白名单 + 去 HATCH”的等效处理，并逐层对照验收，不能只靠图层名猜。

未接 031.3 对外接口，避免把带彩色标注的图当底图交付。

## 031.2 收尾（第三轮）

底图质量与契约问题已修完，逐项有据：

| 问题 | 修法 |
| --- | --- |
| 底图混入彩色标注、吊顶网格、文字 | 按**实体类型**过滤（HATCH/TEXT/MTEXT/DIMENSION/LEADER/ATTRIB/POINT/WIPEOUT/IMAGE），不按图层名猜结构层，墙体 LINE/POLYLINE/SOLID 不受影响 |
| 底图里混着设备符号与连线 | 设备层整体排除出底图，只进参考图 |
| 底图彩色、亮色看不清 | 复用导出器的阅读配色（`paper_palette`），统一白底深色 |
| **底图与 CAD 窗口比例不符** | 纸张宽度固定 420mm、高度按窗口比例算；原来用 A3 纸会把图压成 1.414，设计站 `parsePointMapDraft` 直接以“CAD 坐标窗口与底图比例不符”拒绝 |
| `cad` 绑定字段不合契约 | 只写 `format/version/drawingId/drawingSha256/window` 五项；多写 `kind/pages` 会被判“包含未知字段” |

真实图纸结果：`一层`（page-029 灯具 + page-030 开关 + page-031 插座）

- 底图 `base.png` 3000×2358（窗口 23766.6×18570.6，比例一致），白底黑线，墙、门窗、家具齐全，无彩色标注与吊顶网格。
- 参考图 `ref-lighting.png` / `ref-switch.png` / `ref-socket.png` 同窗口；其中灯光参考图是“符号 + 回路连线”，**缺墙体，必须叠在底图上看**，这是已知限制。
- 点位 62 个（46 灯 + 16 开关），叠点图上与灯位符号对齐；插座页如实报“窗口内没有可提取的设备图块”。
- `draft.json` 通过设计站 `parsePointMapDraft`；契约测试扩到 7 项，新增“窗口比例必须与底图一致”“拒绝多余绑定字段”两项。

剩余：031.3 托管接口、031.4 设计站客户端与路由、031.5 工作台入口、031.6 文档。

## 031.3 实施记录（第四轮）

新增两个文件：

- `scripts/cadcraft/cad-import-worker.mjs`：串起“导出 → 按窗口建楼层 → 草稿”。导出器在 `finally` 里删临时目录，所以让它用 `keepRenderSource` 在清理**之前**把渲染 DXF 落盘；否则下游拿到的是已被删除的路径（这个坑真实踩到过）。
- `（该脚本不随自部署版发布）`：`POST /v1/cad-imports` → 轮询 → 取 `draft.json` / `base.png` / `ref-*.png`。只有 Bearer Token，没有网页与 Cookie；串行执行、队列满 429、产物白名单、失败不开放下载。

契约与安全测试 5 项（`tests/cad-import-api.test.ts`）：令牌缺失 401、全流程取草稿并断言能被 `parsePointMapDraft` 解析、路径穿越与白名单外文件 404、DWG 头不符 422、失败任务 409 不给半成品。

### 端到端实测中发现并修掉的两个设计错误

1. **窗口取错**：`--floor 一层=page-021,...` 取了列表第一页（原始结构图）的窗口，导致灯具/开关全在窗口外，只剩 140 个插座点位。改为优先取“灯具 / 开关 / 平面布置”页的窗口。
2. **楼层内按图名逐页过滤是错的**：那是“一页一层”的旧模型。楼层 = 一个窗口，应提取窗口内**全部设备层**并按图层归类。改后：46 灯 + 16 开关 + 14 空调点位，窗口为灯具页窗口（23640.8 × 18570.7），底图 3000×2358 比例一致。

### 仍未做

- 031.4 设计站侧客户端与 `POST /api/projects/[id]/cad-import`。
- 031.5 工作台入口。
- 镜像里尚未加入这两个新脚本（`Dockerfile` 白名单需补），容器化验证留到下一轮。

## 031.4 实施记录（第五轮）

- `lib/point-map-cad-import.ts`：服务端客户端。`cadImportConfig()` 从 `CAD_IMPORT_SERVICE_URL` / `CAD_IMPORT_SERVICE_TOKEN` 读配置（缺一个就视为未接入）；`requestCadImport()` 上传 → 轮询 → 取草稿，并用设计站自己的 `parsePointMapDraft` 校验；错误统一为 `CadImportError`（未配置 / 无法连接 / 凭据被拒 / 队列满 / 超时 / 上游失败）。
- `lib/cad-import-api.ts` + `app/api/projects/[id]/cad-import/route.ts`：先 `getProjectPointMap`（顺带完成权限校验与取版本）→ 调导入服务 → `mergeDraftIntoPlan` 合并 → `saveProjectPointMap` 按 `expectedRevision` 保存。未配置返回 503 并写明要配什么。
- 令牌只在本进程使用，不进响应、不进 URL；测试专门断言响应体里不含令牌。

测试 10 项（`tests/cad-import-route.test.ts`）：成功导入并返回新增点位、401、503 未配置、文件名校验、上游失败/超时/凭据/项目不存在分别映射、版本冲突透传、重复导入不重复建点、配置校验；另有两项用**真实 HTTP 假服务**验证客户端的上传→轮询→取草稿协议与 401/连接失败翻译。

全量 943 项测试通过，`tsc`、ESLint 通过。

剩余：031.5 工作台入口（前端按钮与预览），031.6 镜像补脚本 + 容器验证与自部署文档补齐。

## 031.6 实施记录（第六轮）

镜像与容器化验证完成：

- `Dockerfile` 白名单补 `cad-import-api.mjs`，构建期加 `node --check` 与 worker 实际 import 检查；`/data-import` 目录与权限补齐（第一次漏了，容器里报“数据目录不可写”）。
- 入口脚本改为按 `CAD_SERVICE=export|import` 切换，令牌变量与数据目录分别校验；导入模式缺 `CAD_IMPORT_API_TOKEN` 直接退出。
- compose 增加 `cad-import` 服务（`profiles: ["import"]`），独立数据卷 `fmkj-cad-import-data`，只绑 `127.0.0.1:4328`。
- 实测：真实 4 MB DWG 在容器内端到端 **76 点（46 灯 + 16 开关 + 14 空调）**，底图 3000×2358，9 个产物齐全；下载的 `draft.json` 通过 `parsePointMapDraft`。
- 过程中修掉一个真实缺陷：worker 未先创建 `output/` 父目录，本地跑因为手工 mkdir 掩盖了它，容器里才暴露（`ENOENT ... output/pages`）。

仍未做：**031.5 工作台入口**（编辑器里的“导入 CAD 生成点位”按钮与预览）。目前客户只能由服务端/API 调用，没有界面入口。031.6 的“文档与部署”已完成，但整体目标仍缺这一步才算闭环。

## 031.5 实施记录（第七轮）

工作台新增“从 CAD 导入生成点位”面板（`components/projects/point-map-workbench.tsx`），位置在工作台主返回树内、原“导入助手点位草稿”面板之前：

- 输入：原图布局名（可选）、楼层名、DWG/DXF 文件。
- 行为：`POST /api/projects/:id/cad-import`，浏览器只与本实例服务端通信，**令牌不出服务端**。
- 成功后直接采用服务端返回的已落库方案（路由为此新增 `plan` 字段），刷新视图并提示“N 个待复核点位、底图尺寸、跳过重复数”，明确说明“按图层归类，房间与型号需人工复核后再确认”。
- 失败时把服务端错误原文显示给用户（未配置 503、超时 504、上游失败 422、版本冲突 409 等）。

验证：`tsc` 与 ESLint 通过；面板位于主 `return`（第 1541 行）内、草稿面板（第 1841 行）之前的第 1790 行，结构位置按行号核对。**未做浏览器登录态实测**——工作台需要登录，`curl` 只拿到登录页（307），仓库也没有组件渲染测试环境（无 jsdom/Testing Library）。因此“界面上点一下能出点位”这一条尚未获得运行证据，只有代码与类型层证据。

至此 031.1–031.6 全部落地。整体目标仍值得继续：补浏览器实测 + 把“两次导入不同楼层”的路径验证掉。

## 双侧联调实测（第七轮末）

用**真实服务 + 真实 DWG** 跑通了“设计站客户端 → 托管导入服务”这条真实链路（此前客户端只用假服务验证过协议）：

```
用时 87s | 任务 3e0aa51a-… | 草稿点位 76 | 合并后 76（新增 76）
楼层 一层 3000x2358
```

调用的是设计站自己的 `requestCadImport()` 与 `mergeDraftIntoPlan()`，即路由实际使用的那两个函数；草稿经 `parsePointMapDraft` 校验后并入空方案，点位全部进入方案。

### 仍未获得运行证据的两点

1. **工作台面板未做浏览器实测**：页面需登录，`curl` 只得登录页；仓库无组件渲染测试环境。面板位置按行号核对位于主返回树内（1790 行，主 return 在 1541 行）。
2. **`/api/projects/:id/cad-import` 在运行中的 Next 应用里未被端到端调用**：未登录时中间件统一返回 `{"error":"UNAUTHORIZED"}`，与不存在的路由表现相同，无法据此确认路由挂载。逻辑层已用注入依赖的 10 项测试覆盖。

补这两点需要可登录的本地会话（或组件测试环境）。在此之前，把“界面点一下就能出点位”视为未验收。

## 收尾验证（第八轮）

上一轮遗留的两项，在运行时层面补齐了证据：

| 项目 | 证据 |
| --- | --- |
| 路由是否真的挂载 | `.next/server/app-paths-manifest.json` 含 `"/api/projects/[id]/cad-import/route" → "app/api/projects/[id]/cad-import/route.js"`，说明已编译并注册进运行中的应用 |
| 工作台面板是否真的下发 | `.next/dev/server/chunks/ssr/components_projects_b5843bd0._.js` 与 `.next/dev/static/chunks/components_projects_c954550c._.js` 均包含“从 CAD 导入生成点位”，即该面板已在 SSR 与服务端/客户端 bundle 中编译通过 |

仍未做的唯一一项：**浏览器里真实点一次**（需要登录态）。它属于交互冒烟，不再是功能缺失——组件已随页面 bundle 下发、类型检查与 lint 通过、调用链有真实 DWG 证据。

## 结论

031.1–031.6 全部完成。可复述的证据链：

1. 真实 DWG → 托管服务 → 76 个待复核点位（46 灯 + 16 开关 + 14 空调点位），底图 3000×2358（比例与 CAD 窗口一致）。
2. 同一链路在容器镜像内复现，产物 `draft.json` 通过设计站 `parsePointMapDraft`。
3. 设计站客户端对**真实服务**跑通：87 秒，草稿 76 点，合并进方案 76 点（新增 76）。
4. 路由已注册、面板已编译下发。
5. 943 项测试、类型检查、ESLint 通过。

已知限制（未变）：图标只到类别级、房间不自动分配、线条绘制的插座提不出点位、参考图缺墙体需叠加、界面未做浏览器登录态冒烟。
