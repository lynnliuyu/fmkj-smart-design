"""从 CAD 图页记录中提取设备点位，输出设计站可直接导入的点位草稿。

与 render-clipped-review.py 使用同一条前端口与同一个页面变换，因此：
- 只有渲染器实际画出来的实体才会被提取（视口冻结、XCLIP、图层关闭都已生效）；
- 记录的包围盒中心经同一矩阵换算成页面百分比，与实际导出的 PNG 一一对应。

不使用 AI、不做自由几何推断：点位只来自可命名的图块与图层，无法确定的写入 reviewReason。

输入 job JSON 与 render-clipped-review.py 相同（source + pages[]），另可给每页对应的底图 PNG。
输出：draft.json（fmkj-point-map-draft）、points.json（可核对清单）、overlay-*.png（叠点核验图）。
"""
import argparse
import base64
import collections
import contextlib
import copy
import io
import json
import sys
import time
from pathlib import Path

import ezdxf
import fitz
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout, recorder
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy
from ezdxf.addons.drawing.pymupdf import get_coordinate_output_space, MM_TO_POINTS
from ezdxf.math import BoundingBox, BoundingBox2d

# 图层关键词 → 设计站图标（lib/point-device-symbols.mjs 的 iconId）。
# 顺序敏感：先匹配更具体的类别。仅按图层与图块名判断，不推断具体型号。
LAYER_RULES = [
    (("灯带",), "light-strip"),
    (("射灯", "spot"), "spotlight"),
    (("筒灯", "downlight"), "downlight"),
    (("吊灯", "pendant"), "pendant-light"),
    (("吸顶", "ceiling"), "ceiling-light"),
    (("壁灯", "wall-light", "walllight"), "wall-light"),
    (("地灯", "走道地灯"), "downlight"),
    (("浴霸",), "exhaust-fan"),
    (("灯具", "灯光", "照明", "light"), "downlight"),
    (("灯控", "开关"), "switch-1"),
    (("强电", "插座", "socket"), "socket"),
    (("空调点位", "空调", "ac-"), "ac-wall"),
    (("摄像", "camera"), "camera"),
    (("新风", "排风", "风机", "exhaust"), "exhaust-fan"),
    (("网关", "gateway"), "gateway"),
    (("面板", "panel"), "panel-small"),
]

LIGHTING_ICONS = {"downlight", "spotlight", "pendant-light", "ceiling-light", "wall-light", "light-strip", "exhaust-fan"}

# 图名 → 该页真正要提的点位类别。开关图上通常会同时画灯具作参考，
# 若不按图名收敛，开关页会重复产出灯具页的点位。
TITLE_RULES = [
    (("灯具", "灯光", "照明", "灯位", "灯控图"), LIGHTING_ICONS),
    (("开关", "灯控"), {"switch-1"}),
    (("插座", "强电", "电源"), {"socket"}),
    (("空调",), {"ac-wall"}),
    (("摄像", "监控"), {"camera"}),
    (("给排水", "水路", "水暖", "地暖"), set()),
]

# 标注类图层不是设备：结构线、尺寸、引线、索引、说明等只是图面辅助。
ANNOTATION_HINTS = ("结构线", "标注", "尺寸", "引线", "说明", "文字", "定位线", "索引", "符号说明")

# 允许出现在图层名里的类别词；用于判断一层到底是不是设备层，而不是把家具层算进来。
DEVICE_HINTS = ("灯", "开关", "插座", "强电", "弱电", "空调", "摄像", "新风", "排风", "网关", "面板", "传感")


def classify(layer: str, block_name: str = "") -> str | None:
    """按图层与图块名归类；两者都不含设备关键词时返回 None（不猜）。"""
    for text in (layer or "", block_name or ""):
        low = text.lower()
        for keywords, icon in LAYER_RULES:
            if any(keyword in low for keyword in keywords):
                return icon
    return None


def is_device_layer(layer: str) -> bool:
    if any(hint in (layer or "") for hint in ANNOTATION_HINTS):
        return False
    return any(hint in (layer or "") for hint in DEVICE_HINTS)


def allowed_icons(page) -> set[str] | None:
    """按图名收敛该页的点位类别；返回 None 表示图名无法判断（保留全部并告警）。"""
    title = " ".join(page.get("labels") or [])
    for keywords, icons in TITLE_RULES:
        if any(keyword in title for keyword in keywords):
            return set(icons)
    return None


def png_pixel_size(raw: bytes) -> tuple[int, int]:
    """从 PNG 头读取真实像素尺寸（宽、高），不经过 DPI 折算。"""
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("底图不是 PNG")
    return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")


def load_document(job):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        doc = ezdxf.readfile(job["source"])
        for item in job.get("sourceLayouts", []):
            if item["name"] == "Model":
                continue
            source = doc.blocks.get(item["blockName"])
            target = doc.layouts.get(item["name"]) if item["name"] in doc.layouts else doc.layouts.new(item["name"])
            if source.block_record.dxf.handle != target.block_record.dxf.handle:
                for entity in list(source):
                    source.move_to_layout(entity, target)
    return doc


def page_records(doc, job, page, cameras):
    """复刻渲染器的可见性判定，返回 (player, matrix, page_size_pt)。"""
    space = doc.layouts.get(page["space"])
    active = {v["handle"].upper() for v in page.get("viewports", [])}
    if page["kind"] == "overview" and page["space"] != "Model":
        active = {e.dxf.handle.upper() for e in space if e.dxftype() == "VIEWPORT"
                  and (e.dxf.handle.upper() not in cameras if cameras else e.dxf.id != 1)}
    for handle in active:
        doc.entitydb[handle].dxf.status = 2
    bounds = page.get("bounds")
    box = BoundingBox(bounds) if bounds else None
    cache = bbox.Cache()

    def keep(entity):
        if entity.dxftype() == "VIEWPORT":
            return entity.dxf.handle.upper() in active
        if box is None:
            return True
        extent = bbox.extents([entity], fast=True, cache=cache)
        return not extent.has_data or extent.has_overlap(box)

    drawing = recorder.Recorder()
    Frontend(RenderContext(doc), drawing, config=Configuration(background_policy=BackgroundPolicy.WHITE), bbox_cache=cache).draw_layout(space, filter_func=keep)
    player = drawing.player()
    render_box = BoundingBox2d(bounds) if bounds else player.bbox()
    if not render_box.has_data:
        raise ValueError("页面没有可渲染内容：" + page["id"])
    settings = layout.Settings(crop_at_margins=True)
    out_layout = layout.Layout(render_box, flip_y=True)
    page_def = out_layout.get_final_page(layout.Page(420, 297), settings)
    scaled = copy.copy(settings)
    scaled.output_coordinate_space = get_coordinate_output_space(page_def)
    matrix = out_layout.get_placement_matrix(page_def, settings=scaled, top_origin=True)
    size = (int(page_def.width_in_mm * MM_TO_POINTS), int(page_def.height_in_mm * MM_TO_POINTS))
    return player, matrix, size


def frozen_layers(page) -> set[str]:
    """该页视口冻结的图层。ezdxf 的前端口不按视口冻结过滤，必须自己排掉，
    否则灯具图、开关图、插座图会提取出完全相同的点位。"""
    layers = set()
    for viewport in page.get("viewports", []) or []:
        layers.update(str(name) for name in viewport.get("frozenLayers", []) or [])
    return layers


def device_centers(player, matrix, size, doc, hidden_layers=frozenset(), allowed=None):
    """一个图块算一个点位：先按实体 handle 合并它的多条记录，再换算成页面百分比。

    直接按 record 逐个取中心会把一个符号拆成多个点（外框、内芯、引线各一条记录），
    这也是之前一份图纸提取出几百个重复点的原因。
    """
    width, height = size
    groups = {}
    for record in player.records:
        layer = player.properties[record.property_hash].layer
        if not is_device_layer(layer) or layer in hidden_layers:
            continue
        handle = getattr(record, "handle", None)
        if not handle:
            continue
        entity = doc.entitydb.get(handle)
        # 只认图块：设备图层上还有连线、回路、管线，它们不是点位。
        if entity is None or entity.dxftype() != "INSERT":
            continue
        icon = classify(layer, entity.dxf.name)
        if not icon or (allowed is not None and icon not in allowed):
            continue
        box = record.bbox()
        if not box.has_data:
            continue
        group = groups.get(handle)
        if group is None:
            groups[handle] = {"layer": layer, "icon": icon, "name": entity.dxf.name, "records": 1,
                              "minx": box.extmin.x, "miny": box.extmin.y, "maxx": box.extmax.x, "maxy": box.extmax.y}
        else:
            group["records"] += 1
            group["minx"] = min(group["minx"], box.extmin.x)
            group["miny"] = min(group["miny"], box.extmin.y)
            group["maxx"] = max(group["maxx"], box.extmax.x)
            group["maxy"] = max(group["maxy"], box.extmax.y)
    candidates = collections.defaultdict(list)
    for group in groups.values():
        span_x = (group["maxx"] - group["minx"]) / width * 100
        span_y = (group["maxy"] - group["miny"]) / height * 100
        # 符号尺寸过滤：图例块、房间级复合块不能用包围盒中心代表点位。
        if max(span_x, span_y) > 2.5 or min(span_x, span_y) <= 0:
            continue
        if max(span_x, span_y) / max(min(span_x, span_y), 1e-6) > 4:
            continue
        center = ((group["minx"] + group["maxx"]) / 2, (group["miny"] + group["maxy"]) / 2)
        page_point = matrix.transform((center[0], center[1], 0))
        candidates[(group["layer"], group["icon"])].append((page_point.x / width * 100, page_point.y / height * 100, group["records"]))
    points = []
    for (layer, icon), positions in candidates.items():
        for x, y, merged in cluster_positions(positions):
            points.append({"x": round(x, 3), "y": round(y, 3), "layer": layer, "iconId": icon, "records": merged})
    points.sort(key=lambda item: (round(item["y"], 1), item["x"]))
    return points


def cluster_positions(positions, radius=0.45):
    """并查集合并：任意两点距离小于 radius 就并为一簇，结果与输入顺序无关。

    单遍贪心（只和已有簇的代表点比较）会产生链式漏合并，留下同心重复点。
    """
    count = len(positions)
    parent = list(range(count))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(count):
        for j in range(i + 1, count):
            if abs(positions[i][0] - positions[j][0]) <= radius and abs(positions[i][1] - positions[j][1]) <= radius:
                if (positions[i][0] - positions[j][0]) ** 2 + (positions[i][1] - positions[j][1]) ** 2 <= radius ** 2:
                    root_i, root_j = find(i), find(j)
                    if root_i != root_j:
                        parent[root_j] = root_i
    merged = collections.defaultdict(list)
    for index in range(count):
        merged[find(index)].append(positions[index])
    result = []
    for members in merged.values():
        x = sum(item[0] for item in members) / len(members)
        y = sum(item[1] for item in members) / len(members)
        result.append((x, y, sum(item[2] for item in members)))
    return result


CODE_PREFIX = {"light-strip": "L", "spotlight": "L", "downlight": "L", "pendant-light": "L", "ceiling-light": "L",
               "wall-light": "L", "exhaust-fan": "L", "switch-1": "S", "socket": "P", "ac-wall": "AC",
               "camera": "C", "gateway": "G", "panel-small": "PN"}

ICON_LABEL = {"light-strip": "灯带", "spotlight": "射灯", "downlight": "筒灯/灯具", "pendant-light": "吊灯",
              "ceiling-light": "吸顶灯", "wall-light": "壁灯", "exhaust-fan": "浴霸/排风", "switch-1": "开关",
              "socket": "插座/强电", "ac-wall": "空调点位", "camera": "摄像头", "gateway": "网关", "panel-small": "面板"}


def build_draft(job, pages, png_paths, floor_names):
    doc = load_document(job)
    cameras = set(job.get("paperCameraHandles", []))
    floors, points, warnings = [], [], []
    for page in pages:
        player, matrix, size = page_records(doc, job, page, cameras)
        allowed = allowed_icons(page)
        found = device_centers(player, matrix, size, doc, frozen_layers(page), allowed)
        label = " / ".join(page.get("labels") or []) or page["id"]
        floor_id = f"floor-{page['id']}"
        floor_name = floor_names.get(page["id"]) or label
        # 设计站契约：sourcePage 必须是 1–100000 的数字，不能是 "page-029" 这样的字符串。
        try:
            source_page = int("".join(ch for ch in page["id"] if ch.isdigit()))
        except ValueError:
            source_page = None
        floor = {"id": floor_id, "name": floor_name, "floorplanName": png_paths[page["id"]].name if page["id"] in png_paths else "",
                 "floorplanDataUrl": "", "imageWidth": size[0], "imageHeight": size[1]}
        if source_page:
            floor["sourcePage"] = source_page
        if page["id"] in png_paths:
            raw = png_paths[page["id"]].read_bytes()
            # 必须报 PNG 的真实像素尺寸：fitz 按 72dpi 折算成 pt，尺寸会偏小（3000→2250），
            # 百分比坐标虽然不变，但设计站用它做画布尺寸，报错就是语义错误。
            floor["imageWidth"], floor["imageHeight"] = png_pixel_size(raw)
            floor["floorplanDataUrl"] = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
        else:
            warnings.append(f"{page['id']} 缺少底图，草稿里该楼层不含图片，请先导出该页 PNG。")
        floors.append(floor)
        if allowed == set():
            warnings.append(f"{page['id']}（{label}）按图名不属于设备点位图（如给排水），未生成点位。")
            continue
        if allowed is None:
            warnings.append(f"{page['id']}（{label}）图名无法判断点位类别，已保留全部设备图层候选，请人工核对。")
        if not found:
            warnings.append(f"{page['id']}（{label}）没有可提取的设备图块；请确认该页是否为灯具 / 开关 / 插座图。")
            continue
        counters = collections.Counter()
        for item in found:
            prefix = CODE_PREFIX.get(item["iconId"], "P")
            counters[prefix] += 1
            code = f"{prefix}-{counters[prefix]:03d}"
            reason = f"按图层“{item['layer']}”归类为{ICON_LABEL.get(item['iconId'], item['iconId'])}；房间归属、具体型号与安装位置需人工复核。"
            # 设计站契约：room 必须是非空文本。CAD 图块无法可靠判断房间归属，
            # 用明确的占位值并在复核原因里说明，不假装已分房间。
            points.append({"id": f"{page['id']}-{code}", "name": f"{ICON_LABEL.get(item['iconId'], item['iconId'])} {code}", "room": "未分房间",
                           "iconId": item["iconId"], "status": "planned", "x": item["x"], "y": item["y"], "productId": "", "note": "",
                           "placed": False, "floorId": floor_id, "code": code, "source": "analysis", "confidence": "medium",
                           "reviewReason": reason})
    return {"format": "fmkj-point-map-draft", "version": 1, "coordinateSystem": "image-percent",
            "floors": floors, "points": points, "scenes": []}, warnings


def write_overlay(png, points, target, radius=16):
    with fitz.open(png) as source:
        width, height = source[0].rect.width, source[0].rect.height
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    page.insert_image(page.rect, filename=str(png))
    for index, point in enumerate(points, start=1):
        center = fitz.Point(point["x"] / 100 * width, point["y"] / 100 * height)
        page.draw_circle(center, radius, color=(1, 0, 0), width=3)
        page.insert_text((center.x + radius, center.y - radius), str(index), fontsize=radius * 1.4, color=(0, 0, 1), fontname="china-s")
    page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False).save(target)
    doc.close()


def main():
    parser = argparse.ArgumentParser(description="从 CAD 图页提取设备点位，生成设计站点位草稿")
    parser.add_argument("job", help="render-job.json（与 render-clipped-review.py 相同结构）")
    parser.add_argument("outdir", help="输出目录（必须尚不存在）")
    parser.add_argument("--pages", help="只处理这些页，逗号分隔；默认全部")
    parser.add_argument("--floorplan", action="append", default=[], help="底图 PNG，形如 page-029=/path/page-029.png，可重复")
    parser.add_argument("--floor-name", action="append", default=[], help="楼层名，形如 page-029=一层，可重复")
    parser.add_argument("--overlay", action="store_true", help="额外输出叠点核验图")
    args = parser.parse_args()

    job = json.loads(Path(args.job).read_text())
    out = Path(args.outdir)
    if out.exists():
        raise SystemExit("输出目录已存在，请换一个新目录：" + str(out))
    out.mkdir(parents=True)
    wanted = set(args.pages.split(",")) if args.pages else None
    pages = [page for page in job["pages"] if wanted is None or page["id"] in wanted]
    if not pages:
        raise SystemExit("没有匹配的页，请检查 --pages")
    png_paths = {item.split("=", 1)[0]: Path(item.split("=", 1)[1]) for item in args.floorplan if "=" in item}
    floor_names = {item.split("=", 1)[0]: item.split("=", 1)[1] for item in args.floor_name if "=" in item}

    started = time.perf_counter()
    draft, warnings = build_draft(job, pages, png_paths, floor_names)
    (out / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {"pages": len(pages), "floors": len(draft["floors"]), "points": len(draft["points"]),
               "byIcon": dict(collections.Counter(p["iconId"] for p in draft["points"])),
               "byFloor": dict(collections.Counter(p["floorId"] for p in draft["points"])),
               "warnings": warnings, "seconds": round(time.perf_counter() - started, 2)}
    (out / "points.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.overlay:
        for page in pages:
            if page["id"] not in png_paths:
                continue
            page_points = [p for p in draft["points"] if p["floorId"] == f"floor-{page['id']}"]
            if page_points:
                write_overlay(png_paths[page["id"]], page_points, out / f"overlay-{page['id']}.png")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
