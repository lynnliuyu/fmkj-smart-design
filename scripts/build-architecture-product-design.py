#!/usr/bin/env python3
"""生成“项目总设计”页：把产品从购买、建项目到交付的整条线，连同支撑线与保障线画在一页。

用途：这一页回答“这个产品整体长什么样、客户拿到的每一个动作对应哪段代码”。
- 上带：两种交付形态（托管版 / 自部署版）与它们的仓库、设备、更新方式；
- 中带：主业务线——登录建项目 → 导入图纸与图片 → 分析选点 → 产品选型 → 报价 → 模板与固定版本 → 客户确认与合同；
- 下带：支撑线（产品库、批量导入、官方同步、数据保存、附件鉴权）与保障线（更新、备份、自助导出还原）；
- 最后一带只放“规划”：这些还没实现，不能当已实现用。
- 每个方框都带 `moduleId` / `status` / `code` / `notes`，供 Agent 读取后再打开代码核对。

约定与其它页一致：实线白底 = 现有代码；虚线浅底 = 规划；灰虚线 = 支撑 / 保障关系。
只改“项目总设计”这一页，其它页原样保留；写回前在 .local/architecture-editor/backups/ 留一份旧文件。

用法：
    python3 scripts/build-architecture-product-design.py            # 写回数据目录里的主文件
    python3 scripts/build-architecture-product-design.py --dry-run  # 只看会生成什么，不写文件

写完按 docs/architecture/README.md 的做法重建清单并同步 Git 副本：
    python3 scripts/architecture-editor-server.py --rebuild-registry 繁梦空间设计站 \
        --data-dir docs/architecture-data --root . \
        --mirror "繁梦空间设计站=docs/architecture/system-map.drawio"
"""
from pathlib import Path
from datetime import datetime
from xml.sax.saxutils import escape
import argparse
import re
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PAGE_NAME = '项目总设计'
EVIDENCE_AS_OF = datetime.now().strftime('%Y-%m-%d')

CURRENT = 'strokeColor=#647188;fillColor=#ffffff;'
PLANNED = 'strokeColor=#9c3d20;fillColor=#fdf6f2;dashed=1;'
SUPPORT = 'strokeColor=#94a3b8;fillColor=#f8fafc;'
FONT = 'fontFamily=PingFang SC;fontColor=#2d3142;'
ATTR_ESCAPES = {'"': '&quot;'}

TITLE = ('项目总设计：从购买到交付', '上带是两种交付形态；中带是主业务线（客户每一步实际发生的事）；下带是支撑线与保障线，最后一带是尚未实现的规划。'
                                   '实线=现有代码，虚线=规划。每个方框都标了代码入口，点开对应分图或代码看细节。')


def label(title, desc='', size=18, desc_size=13):
    html = f'<div style="font-size:{size}px;font-weight:600">{escape(title)}</div>'
    if desc:
        html += f'<div style="font-size:{desc_size}px;line-height:1.45;margin-top:7px">{escape(desc)}</div>'
    return html


# (id, 标题, 描述, x, y, w, h, 状态, 代码, 备注)
NODES = [
    # ── 上带：交付形态与购买 ──────────────────────────────────────────
    ('PD-CUSTOMER', '客户', '企业或个人的浏览器访问；账号类型决定能看哪些项目',
     60, 190, 200, 96, 'current-workflow', 'lib/account-context.ts', ''),
    ('PD-CHANNEL', '购买渠道', '设备采购与账号开通；套餐与订单模型已在后台，线上自助购买未打通',
     300, 190, 200, 96, 'current-workflow', 'lib/account-system/platform-admin-service.ts', '线上支付与自助购买属规划。'),
    ('PD-APPLIANCE', '自部署版', '设备随客户走；客户自己升级、自己备份',
     540, 190, 200, 96, 'current-workflow', 'docker-compose.appliance.yml', '黑豹 X2 已真机跑通首次部署、更新与真实恢复。'),
    ('PD-REPO-PUBLIC', 'fmkj-smart-design', '公开仓库（MIT）= 自部署发行版，由主干导出',
     780, 190, 240, 96, 'current-workflow', 'scripts/open-source-export.mjs', '不在公开仓直接开发，改动全部回流主干。'),
    ('PD-DEVICE', '黑豹x2', '客户现场的 arm64 小主机（RK3566 / 3.8GiB / 29GB）',
     1060, 190, 200, 96, 'current-workflow', 'docs/local-appliance-deployment.md', '设备拉不通 Docker Hub，镜像走自建仓库或离线导入。'),
    ('PD-UPDATE-CHECK', '自动检查更新', '每天问一次有没有新版本；**只提醒，不自动安装**',
     1300, 190, 240, 96, 'current-workflow', 'scripts/deploy/check-update.mjs;deploy/systemd/fmkj-update-check.timer', '用户 2026-10-21 决定：只提醒，由管理员在设备上手动执行更新。'),
    ('PD-HOSTED', '托管版', '浏览器访问官方域名，运营方负责升级与备份',
     540, 320, 200, 96, 'current-workflow', 'docs/deployment-and-catalog-architecture.md', '托管版仍处准备阶段（ADR 0010），未对外正式开放。'),
    ('PD-REPO-PRIVATE', 'fmkjv3', '私有主干 = 唯一开发线，也是正式版',
     780, 320, 240, 96, 'current-workflow', 'docs/open-source-release-process.md', ''),
    ('PD-HOSTED-OPS', '运营方负责升级与备份', '托管版由运营方统一更新、统一备份',
     1060, 320, 240, 96, 'planned', 'docs/deployment-and-catalog-architecture.md', '托管版运维流程未验收，目前只有设备版跑通。'),
    ('PD-OFFLINE', '断网可用（数据不出设备）', '设计与报价在本地完成；客户项目、点位、报价、附件不上传任何上游',
     1340, 320, 240, 96, 'current-workflow', 'docs/adr/0010-hosted-local-deployment-and-optional-catalog.md', 'ADR 0010 硬约束：上游只收产品资料，不收业务数据。'),

    # ── 中带：主业务线 ────────────────────────────────────────────────
    ('PD-LOGIN', '登录与账号权限', '会话签名、页面与接口守卫；未登录访问一律拦到登录页',
     60, 505, 200, 96, 'current-workflow', 'middleware.ts;lib/auth.ts', ''),
    ('PD-PROJECT', '创建项目', '项目归属：企业挂组织，个人挂本人；有创建额度上限',
     300, 505, 200, 96, 'current-workflow', 'lib/project-workflow.ts;app/api/projects/route.ts', ''),
    ('PD-PROJECT-INFO', '项目信息', '客户、楼盘、房号、平台、阶段、风险与下一步安排',
     540, 505, 200, 96, 'current-workflow', 'lib/project-workflow-postgres.ts', ''),
    ('PD-IMPORT-DWG', '导入dwg/png/其他不需要ai可转换格式', '图纸类走本机 CAD 复核；图片类直接当底图',
     780, 505, 240, 96, 'current-workflow', 'scripts/cadcraft-point-map.mjs', 'DWG/DXF 必须选好图框与视口，不是自动布点。'),
    ('PD-CONVERT', '转换格式（不需要ai）', '生成净底 + 逐页 PDF/PNG + 可并排对照的 HTML',
     1060, 505, 220, 96, 'current-workflow', '（该脚本不随自部署版发布）', '保留重名旧方案；未识别图框与空视口如实标出。'),
    ('PD-IMPORT-IMAGE', '导入图片', 'PNG / JPG / WebP 作楼层底图；上传落本地卷、按会话鉴权读取',
     1320, 505, 220, 96, 'current-workflow', 'app/api/upload/route.ts;lib/file-storage.ts', '浏览器上传只收这三种格式，不假装支持 DWG。'),
    ('PD-AI', 'ai处理/分析', '现状＝助手给出点位草稿、人工导入后逐点复核；不是全自动',
     60, 640, 200, 96, 'current-workflow', 'lib/point-map-cad-import.ts', '“自动布点 / 自动报价”仍是规划，见本页最后一带。'),
    ('PD-DIRECTION', '可选分析方向', '按设备类型与图标区分要分析哪几类点位',
     300, 640, 200, 96, 'current-workflow', 'lib/device-types.ts;lib/point-device-symbols.mjs', ''),
    ('PD-PM-LIGHT', '灯具点位图', '灯光回路与灯位', 540, 640, 200, 96, 'current-workflow', 'lib/point-map-design.ts', ''),
    ('PD-PM-SWITCH', '开关点位图', '按键数、继电器路数与接线方式', 780, 640, 200, 96, 'current-workflow', 'lib/point-map-design.ts', '按键数与继电器路数分别核实，不互相推断。'),
    ('PD-PM-CAMERA', '监控点位图', '摄像头点位与覆盖', 1020, 640, 200, 96, 'current-workflow', 'lib/point-map-design.ts', ''),
    ('PD-PM-GATEWAY', '网关点位图', '网关 / 中控位置与覆盖', 1260, 640, 200, 96, 'current-workflow', 'lib/point-map-design.ts', ''),
    ('PD-PM-WIFI', '全屋wifi点位图', 'AP 与无线覆盖', 1500, 640, 200, 96, 'current-workflow', 'lib/point-map-design.ts', ''),
    ('PD-ASSIGN', '确定点位分配/调整', '微调点位、控制灯组与场景，标出未定位 / 未确认的点',
     60, 775, 220, 96, 'current-workflow', 'lib/point-map-marker-layout.ts;lib/point-map-design.ts', ''),
    ('PD-SELECT', '产品选型（点位挂具体 SKU）', '点位关联具体供货 SKU；默认型号可作明确标识的未核验报价',
     320, 775, 220, 96, 'current-workflow', 'lib/product-selection.ts;lib/point-map-selection-service.ts', 'ADR 0006：未核验必须明确标识，不能当作已核验。'),
    ('PD-SAVE-POINTMAP', '保存点位草稿（版本与重试）', '保存带版本号；并发保存按版本拒绝并提示重试',
     580, 775, 220, 96, 'current-workflow', 'lib/point-map-service.ts;app/api/projects/[id]/point-map/route.ts', '保存确认会推进点位版本，包含存活的报价行。'),
    ('PD-QUOTE-DEVICE', '设备报价', '按点位与用料生成报价行；来源行删除联动删点位与场景引用',
     840, 775, 200, 96, 'current-workflow', 'lib/point-map-procurement.ts;lib/quote-save.ts', ''),
    ('PD-QUOTE-LIGHT', '灯具报价', '按房间与灯组独立成行',
     1080, 775, 200, 96, 'current-workflow', 'lib/quote-authoring.ts', ''),
    ('PD-QUOTE-SAVE', '报价核对与保存', '点位来源 / 纯报价 / 快速报价三条入口，都落同一套保存校验',
     1320, 775, 220, 96, 'current-workflow', 'lib/quote-save.ts;lib/quick-quote-service.ts', '价格与成本缺证据时保持待核，不靠导入变成已核验。'),
    ('PD-TEMPLATE-DEFAULT', 'pdf导出模板（默认）', '内置固定版式，客户出口统一',
     60, 910, 220, 96, 'current-workflow', 'lib/point-map-print.ts', ''),
    ('PD-TEMPLATE-API', '模板接口（待完成）', '客户自定义模板目前没有接口，只能用内置版式',
     320, 910, 220, 96, 'planned', 'lib/point-map-print.ts', '需要模板接口时先定版式契约（哪些字段可替换、如何校验）。'),
    ('PD-DELIVERY', '固定交付版本（V 版本）', '不可变的点位、净底、场景、报价金额与商品图字节',
     580, 910, 220, 96, 'current-workflow', 'lib/project-delivery-service.ts', 'ADR 0005 / 0007：客户出口用固定 V 版本，历史版本可完整回看。'),
    ('PD-EXPORT', '导出（PDF / PNG / CSV / JSON）', '从固定版本导出；草稿检查图不作为历史交付',
     840, 910, 220, 96, 'current-workflow', 'lib/client-export.ts;lib/point-map-print.ts', ''),
    ('PD-PDF-QUOTE', 'pdf报价单', '报价单先保存本页报价，再用同一交付版本导出',
     1100, 910, 200, 96, 'current-workflow', 'lib/project-delivery-client.ts', ''),
    ('PD-CONFIRM', '客户确认', '把固定版本给客户看与确认，确认记录留在交付版本上',
     1340, 910, 200, 96, 'current-workflow', 'lib/project-delivery-client.ts', ''),
    ('PD-CONTRACT', '合同', '合同附件与项目绑定，读取按项目可见性判定',
     1580, 910, 200, 96, 'current-workflow', 'lib/contract-attachments.ts;app/api/attachments/route.ts', ''),

    # ── 下带：支撑线 ──────────────────────────────────────────────────
    ('PD-SUP-CATALOG', '产品库（类型・参数・核验状态）', '目录状态、参数核验、价格核验三者分开',
     60, 1095, 240, 96, 'current-workflow', 'lib/product-selection.ts;lib/product-admin-service.ts', '目录“已通过”不等于规格或价格已核验。'),
    ('PD-SUP-IMPORT', '产品批量导入（表格・预览・幂等）', '按系统货号认人；空单元格＝这一项不改',
     340, 1095, 260, 96, 'current-workflow', 'lib/product-import.ts;app/api/admin/products/import/route.ts', '2026-10-22 实现：先预演差异，确认后入库，写入走同一套校验与审计。'),
    ('PD-SUP-SYNC', '官方产品资料同步（服务器・定时）', '验签过的目录 + 产品图一起取回；默认只补新品，不覆盖本地改过的价格',
     640, 1095, 260, 96, 'current-workflow', 'lib/catalog-sync.ts;lib/catalog-sync-service.ts;instrumentation.ts', '2026-10-22 补上 Ed25519 验签与图片取回；增量游标仍在规划，见最后一带。'),
    ('PD-SUP-DATA', '业务数据保存（数据库 + 上传卷）', '业务表在 PostgreSQL，附件在上传卷',
     940, 1095, 240, 96, 'current-workflow', 'lib/server-db.ts;lib/file-storage.ts', ''),
    ('PD-SUP-FILE', '附件受鉴权读取', '按数据库记录判归属，再按项目可见性放行；非位图一律下载',
     1220, 1095, 220, 96, 'current-workflow', 'app/api/files/[...path]/route.ts;lib/file-access.ts', ''),
    ('PD-SUP-ACCESS', '项目访问可见性', '企业按组织、个人按本人、超管全可见；同一规则贯穿项目、附件与交付',
     1480, 1095, 240, 96, 'current-workflow', 'lib/project-access.ts', ''),

    # ── 下带：保障线 ──────────────────────────────────────────────────
    ('PD-GUA-UPDATE', '软件更新（宿主机六步）', 'preflight → fetch → backup → migrate → switch → verify；失败不半新半旧',
     60, 1265, 300, 96, 'current-workflow', 'scripts/deploy/update-local.mjs', '迁移后失败停下等人恢复备份，不假装切回旧镜像就算恢复。'),
    ('PD-GUA-CHECK', '检查更新（只提醒，不自动装）', '每天一次；版本清单可验签，页面显示有无新版本与上次更新结果',
     400, 1265, 260, 96, 'current-workflow', 'scripts/deploy/check-update.mjs;lib/deploy-status.ts', ''),
    ('PD-GUA-BACKUP', '业务备份（宿主机脚本）', 'pg_dump + 上传卷 + 版本信息；保留份数可配',
     700, 1265, 260, 96, 'current-workflow', 'scripts/deploy/backup-local.mjs', '2026-10-21 真机产出并真实恢复到临时库核对。'),
    ('PD-GUA-SELF', '客户自助导出 / 还原（网页）', '客户自己下载备份包保存，出事自己传回来还原；结构不符或内容被改会整体回滚',
     1000, 1265, 320, 96, 'current-workflow', 'lib/backup-service.ts;app/api/admin/backup/route.ts', '2026-10-22 实现；应用起不来时仍走宿主机 pg_restore 兜底。'),
    ('PD-GUA-VERSION', '固定交付版本可完整回看', '历史交付版本不可变，选择器可完整回看',
     1360, 1265, 240, 96, 'current-workflow', 'lib/project-delivery-service.ts', ''),

    # ── 规划带：还没实现 ──────────────────────────────────────────────
    ('PD-PLAN-AI', 'AI 自动分析图纸并布点', '现在必须人工确认图框、逐点复核；全自动未实现',
     60, 1435, 240, 96, 'planned', 'scripts/cadcraft-point-map.mjs', ''),
    ('PD-PLAN-QUOTE', '自动报价', '现在由人选型、核对价格与依据；自动报价未实现',
     340, 1435, 220, 96, 'planned', 'lib/quote-save.ts', ''),
    ('PD-PLAN-SYNC', '官方同步：增量游标与分批', '目前一次拉整份快照；目录涨大后需要分批与断点续传',
     600, 1435, 320, 96, 'planned', 'lib/catalog-sync.ts', '验签与图片取回已完成（2026-10-22）；订阅到期与宽限期同样未实现。'),
    ('PD-PLAN-MOVE', '多实例与换机搬迁', '换设备搬数据目前靠备份整库恢复',
     960, 1435, 240, 96, 'planned', 'docs/local-appliance-deployment.md', ''),
]

# (id, 起点, 终点, 文字, 是否虚线, 颜色, 方向)
EDGES = [
    # 交付形态
    ('pd-e-1', 'PD-CUSTOMER', 'PD-CHANNEL', '', False, '#647188', 'side'),
    ('pd-e-2', 'PD-CHANNEL', 'PD-APPLIANCE', '', False, '#647188', 'side'),
    ('pd-e-3', 'PD-CHANNEL', 'PD-HOSTED', '', False, '#647188', 'down'),
    ('pd-e-4', 'PD-APPLIANCE', 'PD-REPO-PUBLIC', '', False, '#647188', 'side'),
    ('pd-e-5', 'PD-REPO-PUBLIC', 'PD-DEVICE', '', False, '#647188', 'side'),
    ('pd-e-6', 'PD-DEVICE', 'PD-UPDATE-CHECK', '', False, '#647188', 'side'),
    ('pd-e-7', 'PD-HOSTED', 'PD-REPO-PRIVATE', '', False, '#647188', 'side'),
    ('pd-e-8', 'PD-REPO-PRIVATE', 'PD-HOSTED-OPS', '', True, '#9c3d20', 'side'),
    ('pd-e-9', 'PD-DEVICE', 'PD-OFFLINE', '', False, '#647188', 'side'),
    ('pd-e-10', 'PD-HOSTED-OPS', 'PD-OFFLINE', '', True, '#9c3d20', 'side'),
    # 主业务线 · 第一段
    ('pd-e-11', 'PD-LOGIN', 'PD-PROJECT', '', False, '#2e5aa8', 'side'),
    ('pd-e-12', 'PD-PROJECT', 'PD-PROJECT-INFO', '', False, '#2e5aa8', 'side'),
    ('pd-e-13', 'PD-PROJECT-INFO', 'PD-IMPORT-DWG', '', False, '#2e5aa8', 'side'),
    ('pd-e-14', 'PD-IMPORT-DWG', 'PD-CONVERT', '', False, '#2e5aa8', 'side'),
    ('pd-e-15', 'PD-CONVERT', 'PD-IMPORT-IMAGE', '', False, '#2e5aa8', 'side'),
    ('pd-e-16', 'PD-IMPORT-DWG', 'PD-AI', '', False, '#2e5aa8', 'down'),
    ('pd-e-17', 'PD-IMPORT-IMAGE', 'PD-AI', '', False, '#2e5aa8', 'down'),
    # 主业务线 · 第二段
    ('pd-e-18', 'PD-AI', 'PD-DIRECTION', '', False, '#2e5aa8', 'side'),
    ('pd-e-19', 'PD-DIRECTION', 'PD-PM-LIGHT', '', False, '#2e5aa8', 'side'),
    ('pd-e-20', 'PD-DIRECTION', 'PD-PM-SWITCH', '', False, '#2e5aa8', 'down'),
    ('pd-e-21', 'PD-DIRECTION', 'PD-PM-CAMERA', '', False, '#2e5aa8', 'down'),
    ('pd-e-22', 'PD-DIRECTION', 'PD-PM-GATEWAY', '', False, '#2e5aa8', 'down'),
    ('pd-e-23', 'PD-DIRECTION', 'PD-PM-WIFI', '', False, '#2e5aa8', 'down'),
    ('pd-e-24', 'PD-PM-LIGHT', 'PD-ASSIGN', '', False, '#2e5aa8', 'down'),
    ('pd-e-25', 'PD-PM-SWITCH', 'PD-ASSIGN', '', False, '#2e5aa8', 'down'),
    ('pd-e-26', 'PD-PM-CAMERA', 'PD-ASSIGN', '', False, '#2e5aa8', 'down'),
    ('pd-e-27', 'PD-PM-GATEWAY', 'PD-ASSIGN', '', False, '#2e5aa8', 'down'),
    ('pd-e-28', 'PD-PM-WIFI', 'PD-ASSIGN', '', False, '#2e5aa8', 'down'),
    # 主业务线 · 第三段
    ('pd-e-29', 'PD-ASSIGN', 'PD-SELECT', '', False, '#2e5aa8', 'side'),
    ('pd-e-30', 'PD-SELECT', 'PD-SAVE-POINTMAP', '', False, '#2e5aa8', 'side'),
    ('pd-e-31', 'PD-SAVE-POINTMAP', 'PD-QUOTE-DEVICE', '', False, '#2e5aa8', 'side'),
    ('pd-e-32', 'PD-QUOTE-DEVICE', 'PD-QUOTE-LIGHT', '', False, '#2e5aa8', 'side'),
    ('pd-e-33', 'PD-QUOTE-LIGHT', 'PD-QUOTE-SAVE', '', False, '#2e5aa8', 'side'),
    ('pd-e-34', 'PD-QUOTE-DEVICE', 'PD-QUOTE-SAVE', '', False, '#2e5aa8', 'down'),
    # 主业务线 · 第四段
    ('pd-e-35', 'PD-QUOTE-SAVE', 'PD-TEMPLATE-DEFAULT', '', False, '#2e5aa8', 'down'),
    ('pd-e-36', 'PD-QUOTE-SAVE', 'PD-TEMPLATE-API', '', True, '#9c3d20', 'down'),
    ('pd-e-37', 'PD-TEMPLATE-DEFAULT', 'PD-DELIVERY', '', False, '#2e5aa8', 'side'),
    ('pd-e-38', 'PD-TEMPLATE-API', 'PD-DELIVERY', '', True, '#9c3d20', 'side'),
    ('pd-e-39', 'PD-DELIVERY', 'PD-EXPORT', '', False, '#2e5aa8', 'side'),
    ('pd-e-40', 'PD-EXPORT', 'PD-PDF-QUOTE', '', False, '#2e5aa8', 'side'),
    ('pd-e-41', 'PD-PDF-QUOTE', 'PD-CONFIRM', '', False, '#2e5aa8', 'side'),
    ('pd-e-42', 'PD-CONFIRM', 'PD-CONTRACT', '', False, '#2e5aa8', 'side'),
    # 支撑线连回主线（灰虚线）
    ('pd-e-51', 'PD-SUP-ACCESS', 'PD-PROJECT', '', True, '#94a3b8', 'up'),
    ('pd-e-52', 'PD-SUP-CATALOG', 'PD-SELECT', '', True, '#94a3b8', 'up'),
    ('pd-e-53', 'PD-SUP-IMPORT', 'PD-SUP-CATALOG', '', True, '#94a3b8', 'side'),
    ('pd-e-54', 'PD-SUP-SYNC', 'PD-SUP-CATALOG', '', True, '#94a3b8', 'side'),
    ('pd-e-55', 'PD-SUP-DATA', 'PD-SAVE-POINTMAP', '', True, '#94a3b8', 'up'),
    ('pd-e-56', 'PD-SUP-FILE', 'PD-CONTRACT', '', True, '#94a3b8', 'up'),
    # 保障线连回主线（灰虚线）
    ('pd-e-61', 'PD-GUA-UPDATE', 'PD-APPLIANCE', '', True, '#94a3b8', 'up'),
    ('pd-e-62', 'PD-GUA-CHECK', 'PD-UPDATE-CHECK', '', True, '#94a3b8', 'up'),
    ('pd-e-63', 'PD-GUA-BACKUP', 'PD-SUP-DATA', '', True, '#94a3b8', 'up'),
    ('pd-e-64', 'PD-GUA-SELF', 'PD-GUA-BACKUP', '', True, '#94a3b8', 'side'),
    ('pd-e-65', 'PD-GUA-VERSION', 'PD-DELIVERY', '', True, '#94a3b8', 'up'),
    # 规划连到它将来要改变的地方（红虚线）
    ('pd-e-71', 'PD-PLAN-AI', 'PD-AI', '', True, '#9c3d20', 'up'),
    ('pd-e-72', 'PD-PLAN-QUOTE', 'PD-QUOTE-SAVE', '', True, '#9c3d20', 'up'),
    ('pd-e-73', 'PD-PLAN-SYNC', 'PD-SUP-SYNC', '', True, '#9c3d20', 'up'),
    ('pd-e-74', 'PD-PLAN-MOVE', 'PD-DEVICE', '', True, '#9c3d20', 'up'),
]


def obj_xml(node_id, title, desc, x, y, w, h, status, code, notes):
    fill = PLANNED if status == 'planned' else CURRENT
    props = {
        'moduleId': node_id,
        'title': title,
        'description': desc.replace('**', ''),
        'status': status,
        'code': code,
        'rules': '',
        'evidenceAsOf': EVIDENCE_AS_OF,
        'notes': notes,
        'id': node_id,
        'label': label(title, desc.replace('**', '')),
    }
    attrs = ' '.join(f'{k}="{escape(str(v), ATTR_ESCAPES)}"' for k, v in props.items())
    style = (f'rounded=1;arcSize=5;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;'
             f'spacing=10;{FONT}strokeWidth=1.3;{fill}')
    return f'''<object {attrs}>
  <mxCell style="{style}" vertex="1" parent="1">
    <mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" />
  </mxCell>
</object>'''


def edge_xml(edge_id, source, target, text, planned, color, direction='side'):
    dashed = 'dashed=1;' if planned else ''
    stroke = '1.2' if color == '#94a3b8' else '1.5'
    terminal = {
        'down': 'exitX=0.5;exitY=1;entryX=0.5;entryY=0;',
        'up': 'exitX=0.5;exitY=0;entryX=0.5;entryY=1;',
        'side': 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;',
        'side-left': 'exitX=0;exitY=0.5;entryX=1;entryY=0.5;',
    }[direction]
    routing = '' if direction in ('down', 'up') else 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;'
    style = (f'{routing}html=1;endArrow=block;endFill=1;strokeColor={color};strokeWidth={stroke};{dashed}'
             'fontColor=#4f5d75;fontSize=14;labelBackgroundColor=#f5f5f5;fontFamily=PingFang SC;' + terminal)
    return f'''<mxCell id="{edge_id}" edge="1" parent="1" source="{source}" target="{target}" style="{style}" value="{escape(text)}">
  <mxGeometry relative="1" as="geometry" />
</mxCell>'''


def band_xml(text, y, color='#4f5d75', size=20):
    return f'''<mxCell id="pd-band-{y}" value="{escape(text)}" style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontSize={size};fontColor={color};{FONT}" vertex="1" parent="1">
  <mxGeometry x="60" y="{y}" width="1500" height="32" as="geometry" />
</mxCell>'''


def legend_xml():
    items = [('现有代码流程', CURRENT), ('规划（尚未实现，不能当已实现用）', PLANNED), ('支撑 / 保障关系', SUPPORT)]
    cells = []
    x = 60
    for index, (text, fill) in enumerate(items):
        cells.append(f'''<mxCell id="pd-legend-{index}-box" value="" style="rounded=1;whiteSpace=wrap;html=1;{fill}strokeWidth=1.3;" vertex="1" parent="1">
  <mxGeometry x="{x}" y="1600" width="34" height="22" as="geometry" />
</mxCell>
<mxCell id="pd-legend-{index}-text" value="{escape(text)}" style="text;html=1;align=left;verticalAlign=middle;{FONT}fontSize=15;" vertex="1" parent="1">
  <mxGeometry x="{x + 42}" y="1600" width="360" height="22" as="geometry" />
</mxCell>''')
        x += 420
    return cells


def design_page_xml():
    title = f'''<mxCell id="pd-title" value="{escape(TITLE[0])}" style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontSize=34;{FONT}" vertex="1" parent="1">
  <mxGeometry x="60" y="26" width="1500" height="50" as="geometry" />
</mxCell>'''
    subtitle = f'''<mxCell id="pd-subtitle" value="{escape(TITLE[1])}" style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontSize=17;fontColor=#4f5d75;fontFamily=PingFang SC;" vertex="1" parent="1">
  <mxGeometry x="60" y="78" width="1500" height="52" as="geometry" />
</mxCell>'''
    note = f'''<mxCell id="pd-note" value="{escape("图下注释：现有 / 规划是人工声明，附代码引用日期 " + EVIDENCE_AS_OF + "，只说明实现位置，不代表验收结论；读图后仍要打开代码核对。")}" style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontSize=15;fontColor=#4f5d75;fontFamily=PingFang SC;" vertex="1" parent="1">
  <mxGeometry x="60" y="1640" width="1500" height="40" as="geometry" />
</mxCell>'''

    body = [title, subtitle,
            band_xml('① 交付形态与购买（两种卖法：托管版 / 自部署版）', 140, '#2e5aa8', 22),
            band_xml('② 主业务线（客户每一步实际发生的事）', 455, '#2e5aa8', 22),
            band_xml('③ 支撑线（每条业务都要经过）', 1045, '#4f5d75'),
            band_xml('④ 保障线（设备版已验收的部分）', 1215, '#4f5d75'),
            band_xml('⑤ 规划（还没实现，先别当功能用）', 1385, '#9c3d20')]
    body += [obj_xml(*node) for node in NODES]
    body += [edge_xml(*edge) for edge in EDGES]
    body += legend_xml()
    body.append(note)

    model = f'''<mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1760" pageHeight="1360" background="#f5f5f5" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        {chr(10).join("        " + line for cell in body for line in cell.splitlines()).strip()}
      </root>
    </mxGraphModel>'''
    return f'<diagram id="product-design" name="{PAGE_NAME}">\n    {model}\n  </diagram>'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data-dir', default=str(ROOT / 'docs/architecture-data'))
    parser.add_argument('--project', default='繁梦空间设计站')
    parser.add_argument('--target', default='', help='直接指定要写的 .drawio（默认写数据目录里的主文件）')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    doc = Path(args.target) if args.target else Path(args.data_dir) / 'projects' / args.project / 'system-map.drawio'
    if not doc.exists():
        raise SystemExit(f'找不到目标文件：{doc}')
    xml = doc.read_text(encoding='utf-8')

    # 先删掉旧的同名页，再插到最后一页（它是一张总览页，放在分图之后）。
    xml = re.sub(r'\s*<diagram\b[^>]*name="' + re.escape(PAGE_NAME) + r'"[\s\S]*?</diagram>', '', xml)
    if '<diagram' not in xml:
        raise SystemExit('目标文件里没有任何图页，拒绝写入')
    xml = re.sub(r'(\s*)</mxfile>', lambda m: '\n  ' + design_page_xml() + m.group(1) + '</mxfile>', xml, count=1)
    pages = len(re.findall(r'<diagram\b', xml))
    xml = re.sub(r'pages="\d+"', f'pages="{pages}"', xml, count=1)

    root = ET.fromstring(xml)
    page = root.find(f'./diagram[@name="{PAGE_NAME}"]')
    if page is None:
        raise SystemExit('项目总设计页生成失败')
    vertices = len(page.findall('.//mxCell[@vertex="1"]'))
    edges = len(page.findall('.//mxCell[@edge="1"]'))
    objects = len(page.findall('.//object'))
    planned = sum(1 for node in NODES if node[7] == 'planned')
    print(f'项目总设计：{vertices} 个节点（其中 {objects} 个带 moduleId、{planned} 个规划）、{edges} 条连线；总页数 {pages}')

    if args.dry_run:
        print('--dry-run：不写文件')
        return
    if not args.target:
        backup = ROOT / '.local/architecture-editor/backups'
        backup.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        shutil.copy2(doc, backup / f'{stamp}-before-product-design.drawio')
        print(f'旧版备份：{backup / (stamp + "-before-product-design.drawio")}')
    doc.write_text(xml, encoding='utf-8')
    print(f'已写回 {doc}')


if __name__ == '__main__':
    main()
