# CAD 导入接口（面向自部署设计站）

把客户 DWG 变成设计站可直接导入的**点位草稿 + 底图 + 参考图**。由我方托管运行；客户自行部署的繁梦空间设计站通过配置地址与令牌调用，令牌只在服务端之间传递。

与[图纸导出接口](cad-export-api.md)（面向客户取审阅图纸）是两个端点，共用同一套 CAD 解码与渲染链路。

## 端点

| 方法与路径 | 含义 |
| --- | --- |
| `POST /v1/cad-imports?filename=x.dwg[&space=布局名][&floorName=一层]` | 上传原始文件字节，返回 202 与任务地址 |
| `GET /v1/cad-imports/:id` | 状态、进度、结果摘要与文件地址 |
| `GET /v1/cad-imports/:id/files/:name` | 取草稿、底图、参考图、清单 |
| `DELETE /v1/cad-imports/:id` | 删除已结束任务及其图纸副本 |
| `GET /health` | 存活与队列（同样需要令牌） |

`space` 用原始布局名；省略时导出全部布局。`floorName` 写入草稿楼层名，默认 `一层`。

## 启动

```sh
export CAD_IMPORT_API_TOKEN="$(openssl rand -hex 32)"
export CADCRAFT_CLI='/path/cadcraft-cli'
export PDFTOPPM='/path/pdftoppm'
export CAD_REVIEW_PYTHON='/path/python-with-ezdxf-fitz'
node （该脚本不随自部署版发布）
```

默认 `127.0.0.1:4328`。依赖与导出接口相同：CADCraft CLI、Poppler、Python（ezdxf ≥ 1.4.5 / PyMuPDF / pypdf / Pillow）、中文字体。

| 环境变量 | 默认 |
| --- | --- |
| `CAD_IMPORT_API_TOKEN` | 必填，≥32 字符 |
| `CAD_IMPORT_HOST` / `CAD_IMPORT_PORT` | `127.0.0.1` / `4328` |
| `CAD_IMPORT_DATA_DIR` | `.local/cad-import-api` |
| `CAD_IMPORT_MAX_BYTES` | 100 MiB |
| `CAD_IMPORT_MAX_PENDING` | 4 |
| `CAD_IMPORT_TIMEOUT_MS` | 30 分钟 |
| `CAD_IMPORT_PAGE_TIMEOUT_MS` | 180 秒（单页渲染上限） |
| `CAD_REVIEW_PYTHONPATH` | 可选，ezdxf 所在目录 |

## 成功结果

```json
{
  "id": "…", "status": "succeeded",
  "result": {
    "floor": "一层", "imageWidth": 3000, "imageHeight": 2358,
    "pointCount": 62, "byIcon": { "downlight": 46, "switch-1": 16 },
    "warnings": ["page-031（插座定位图）窗口内没有可提取的设备图块。"],
    "draftUrl": "/v1/cad-imports/…/files/draft.json",
    "files": [{ "name": "draft.json", "url": "…" }, { "name": "base.png", "url": "…" }, …]
  }
}
```

- `draft.json`：`fmkj-point-map-draft` 草稿，可直接被设计站 `parsePointMapDraft` 导入。
- `base.png`：按 CAD 模型窗口渲染的**白底黑线底图**，宽高比与草稿里的 `cad.window` 一致（设计站会校验 ±0.5%）。
- `ref-lighting.png` / `ref-switch.png` / `ref-socket.png`：同窗口参考图，**需要叠在底图上看**（灯光参考图只有符号与回路连线，没有墙体）。
- `overlay.png`：点位叠在底图上的核验图，用于人工快速确认。
- `points.json` / `floor.json` / `result.json`：点位清单、楼层摘要、来源指纹。

## 点位是怎么来的

1. 复用导出器解码 DWG、识别图幅，并按页渲染。
2. 取目标布局的**模型窗口**，按窗口渲染底图与参考图；点位坐标与底图严格同源。
3. 从窗口内的**图块（INSERT）**提取设备点位：一个图块一个点，排除连线、管线与标注。
4. 按**图层关键词**归类（`D-灯具空调`→灯具、`D-灯控`→开关、`D-强电`→插座…），并按**图名**收敛该页要提的类别。
5. 排除视口冻结图层与标注层；无法确定的写入 `reviewReason`，状态 `planned`，不自动确认。

不调用 AI、不上传第三方、不做自由几何推断。图纸里没有可命名图块时，明确返回失败而不是编造点位。

## 已知限制

- **图标只到类别级**：灯具一律 `downlight`、开关一律 `switch-1`；块名是 `A$C52335EB2` 这类匿名名时无法细分射灯/吊灯/灯带。
- **房间不自动分配**：`room` 固定为 `未分房间`，需在编辑器里归房。
- **插座等用线条绘制的图元提不出点位**，会明确告警。
- 单服务串行执行一个导入，队列满返回 429；不是无服务器函数。
- 参考图缺墙体，只能叠加核对。

## 安全与边界

- 只有 Bearer Token，没有网页与 Cookie 会话；令牌不进浏览器、URL 或日志。
- 上传只接受 DWG/DXF 原始字节，校验文件头；产物按白名单提供服务，非法名一律 404。
- 任务目录含客户图纸与产物，按敏感数据管理；用 `DELETE` 清理，默认不自动过期。
- 生成的草稿是**待复核**点位，不是已确认方案，也不写任何项目的报价或交付版本。

## 设计站侧对接（客户自部署）

设计站通过两个服务端环境变量接入，**令牌只放服务端**，不会下发浏览器：

```sh
export CAD_IMPORT_SERVICE_URL='https://你的导入服务域名'
export CAD_IMPORT_SERVICE_TOKEN='与服务端 CAD_IMPORT_API_TOKEN 相同'
```

接口：`POST /api/projects/:id/cad-import?filename=客户.dwg&space=平面图&floorName=一层`

- 请求体是 CAD 原始字节（`application/octet-stream`），不是表单。
- 流程：取当前点位方案（顺便完成权限校验）→ 调用导入服务 → 用设计站自己的 `parsePointMapDraft` 校验草稿 → `importPointMapDraft` 合并（保留已有编辑、重复导入不重复建点）→ 按 `expectedRevision` 保存。
- 响应：`{ revision, added, skipped, floor, pointCount, imageWidth, imageHeight, importId }`。

错误码：

| 状态 | 含义 |
| --- | --- |
| 401 | 未登录设计站 |
| 400 | 文件名含路径 / 后缀不符 / 空文件 |
| 413 | 超过导入服务大小限制 |
| 422 | 导入服务未能生成点位（图纸没有可命名图块等） |
| 429 | 导入服务队列已满 |
| 503 | 本实例未配置 `CAD_IMPORT_SERVICE_URL` / `TOKEN` |
| 504 | 导入超时 |
| 409 | 点位方案版本冲突，需重新加载后重试 |

未配置时返回 503 并说明该配什么，不会静默失败或假装成功。上游返回的令牌、内部路径都不会出现在响应里。
