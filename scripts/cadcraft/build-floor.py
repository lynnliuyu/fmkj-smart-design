"""按“模型窗口”构建一个楼层：干净底图 + 灯光/开关参考图 + 点位草稿。

为什么按模型窗口而不是直接拿图纸页当底图：
- 图纸页带着图框、标题栏、比例标注，不适合做点位底图；
- 同一层的灯具图、开关图、插座图是不同图纸页，纸面位置各不相同，但**模型窗口相同**，
  以窗口为基准才能让底图与各参考图、点位坐标严格对齐。

输入：render-job.json（含 source 与 pages[]，用于取窗口与图层信息）。
输出：floor.json（单层草稿）、base.png、ref-*.png、overlay-*.png、summary.json。
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
from ezdxf.math import BoundingBox2d

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

_spec = importlib.util.spec_from_file_location("extract_points", Path(__file__).resolve().parent / "extract-points.py")
extract = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(extract)

_render_spec = importlib.util.spec_from_file_location("render_clipped_review", Path(__file__).resolve().parent / "render-clipped-review.py")
_render = importlib.util.module_from_spec(_render_spec)
_render_spec.loader.exec_module(_render)
paper_palette = _render.paper_palette

# 底图不该出现的实体类型：栅格填充、文字、尺寸、引线、图片。删这些不依赖图层命名，
# 比按图层名猜“哪层是墙”安全：墙体是 LINE/POLYLINE/SOLID，不会被动到。
BASE_SKIP_TYPES = {"HATCH", "TEXT", "MTEXT", "DIMENSION", "LEADER", "MULTILEADER", "ATTRIB", "ATTDEF", "POINT", "WIPEOUT", "IMAGE"}

# 参考图类型 → 该类型要显示的设备层关键词（其余设备层隐藏，得到单类参考图）。
REFERENCE_KINDS = {
    "lighting": ("灯", "照明"),
    "switch": ("灯控", "开关"),
    "socket": ("强电", "插座"),
}


def layer_visible(layer: str, kinds) -> bool:
    """底图保留结构层；参考图只保留对应设备层，压在底图上便于核对。"""
    if not kinds:
        return True
    return any(keyword in (layer or "") for keyword in kinds)


def render_window(doc, window, image_long_edge, kinds, reference=False):
    """把模型空间按窗口渲染成 PNG 并统一成白底黑线。

    - 底图（reference=False）：去掉填充/文字/尺寸/引线，去掉设备层与标注层，只留结构。
    - 参考图（reference=True）：保留结构层 + 指定类别的设备层，便于叠在底图上核对。
    返回 (png bytes, 页宽 pt, 页高 pt, matrix)。
    """
    # window 是扁平 [x0,y0,x1,y1]，BoundingBox2d 需要两个角点。
    box = BoundingBox2d([(window[0], window[1]), (window[2], window[3])])
    cache = bbox.Cache()

    def keep(entity):
        if entity.dxftype() in BASE_SKIP_TYPES:
            return False
        layer = entity.dxf.layer
        if reference:
            # 参考图：非设备层（结构）保留，设备层只保留本类别。
            if extract.is_device_layer(layer) and not layer_visible(layer, kinds):
                return False
        else:
            # 底图：设备层与标注层都不进底图，符号与连线留在参考图里。
            if extract.is_device_layer(layer):
                return False
        extent = bbox.extents([entity], fast=True, cache=cache)
        return not extent.has_data or extent.has_overlap(box)

    drawing = recorder.Recorder()
    Frontend(RenderContext(doc), drawing, config=Configuration(background_policy=BackgroundPolicy.WHITE), bbox_cache=cache).draw_layout(doc.modelspace(), filter_func=keep)
    player = drawing.player()
    # 关键：纸张与窗口同比例。设计站要求 底图宽高比 = CAD 窗口宽高比（±0.5%），
    # 用 A3 纸输出会把底图压成 1.414，坐标窗口对不上，导入直接被拒绝。
    page_width_mm = 420.0
    page_height_mm = page_width_mm * (window[3] - window[1]) / (window[2] - window[0])
    settings = layout.Settings(crop_at_margins=False)
    out_layout = layout.Layout(box, flip_y=True)
    page_def = out_layout.get_final_page(layout.Page(page_width_mm, page_height_mm), settings)
    scaled = copy.copy(settings)
    scaled.output_coordinate_space = get_coordinate_output_space(page_def)
    matrix = out_layout.get_placement_matrix(page_def, settings=scaled, top_origin=True)
    width_pt, height_pt = int(page_def.width_in_mm * MM_TO_POINTS), int(page_def.height_in_mm * MM_TO_POINTS)

    from pdf_backend import BufferedPdfBackend
    backend = BufferedPdfBackend()
    # 统一成白底深色：复用导出器的阅读配色，避免彩色标注与亮色线看不清。
    player.copy().replay(backend, override=paper_palette)
    pdf = backend.get_pdf_bytes(layout.Page(page_width_mm, page_height_mm), render_box=box, settings=settings)
    with fitz.open(stream=pdf, filetype="pdf") as document:
        scale = image_long_edge / max(document[0].rect.width, document[0].rect.height)
        png = document[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")
    return png, width_pt, height_pt, matrix


def window_points(doc, window, matrix, size, kinds, allowed):
    """窗口内的设备图块 → 页面百分比。一个图块一个点。"""
    width, height = size
    groups = {}
    for entity in doc.modelspace():
        if entity.dxftype() != "INSERT":
            continue
        layer = entity.dxf.layer
        if not extract.is_device_layer(layer):
            continue
        if not layer_visible(layer, kinds):
            continue
        icon = extract.classify(layer, entity.dxf.name)
        if not icon or (allowed is not None and icon not in allowed):
            continue
        point = entity.dxf.insert
        if not (window[0] <= point.x <= window[2] and window[1] <= point.y <= window[3]):
            continue
        groups.setdefault((layer, icon), []).append((point.x, point.y))
    points = []
    for (layer, icon), positions in groups.items():
        percent = []
        for x, y in positions:
            q = matrix.transform((x, y, 0))
            percent.append((q.x / width * 100, q.y / height * 100, 1))
        for px, py, merged in extract.cluster_positions(percent):
            points.append({"x": round(px, 3), "y": round(py, 3), "layer": layer, "iconId": icon, "records": merged})
    points.sort(key=lambda item: (round(item["y"], 1), item["x"]))
    return points


def main():
    parser = argparse.ArgumentParser(description="按模型窗口构建楼层：底图 + 参考图 + 点位草稿")
    parser.add_argument("job", help="render-job.json（用于取 source 与页面窗口/图层）")
    parser.add_argument("outdir", help="输出目录（必须尚不存在）")
    parser.add_argument("--floor", required=True, help="楼层名=页号[,页号...]，第一个页提供窗口；如 一层=page-029,page-030")
    parser.add_argument("--window", help="显式窗口 x0,y0,x1,y1；省略时用 --floor 第一个页的视口窗口")
    parser.add_argument("--icon", default="downlight", help="参考点位默认图标（仅用于 name 前缀，便于区分）")
    parser.add_argument("--long-edge", type=int, default=3000)
    parser.add_argument("--source-sha256", default="", help="源 DWG/DXF 的 SHA-256；省略时按文件名与窗口推导（仅用于本地测试）")
    args = parser.parse_args()

    job = json.loads(Path(args.job).read_text())
    name, _, page_ids = args.floor.partition("=")
    if not name or not page_ids:
        raise SystemExit("--floor 需要 楼层名=页号[,页号...]")
    ids = [item.strip() for item in page_ids.split(",") if item.strip()]
    pages = {page["id"]: page for page in job["pages"]}
    missing = [item for item in ids if item not in pages]
    if missing:
        raise SystemExit("未知页号：" + "、".join(missing))

    if args.window:
        window = [float(v) for v in args.window.split(",")]
    else:
        # 窗口取“同一层里最能代表平面”的那一页：优先灯具/开关/平面布置，
        # 否则取第一页。取错窗口会把别的楼层或局部区域当成底图范围。
        preferred = next((item for item in ids if any(key in " ".join(pages[item].get("labels") or [])
                          for key in ("灯具", "开关", "平面布置", "布置图"))), ids[0])
        window = pages[preferred]["viewports"][0]["window"]
    window = [window[0][0], window[0][1], window[1][0], window[1][1]] if isinstance(window[0], list) else window
    if len(window) != 4 or window[2] <= window[0] or window[3] <= window[1]:
        raise SystemExit("窗口无效，需要 x0,y0,x1,y1 且 x1>x0、y1>y0")

    out = Path(args.outdir)
    if out.exists():
        raise SystemExit("输出目录已存在，请换一个新目录：" + str(out))
    out.mkdir(parents=True)
    started = time.perf_counter()

    # 源图纸指纹：优先用显式给出，其次用 job 里的文件名+窗口推导，最后才用空值占位。
    source_sha256 = args.source_sha256
    if not source_sha256:
        import hashlib
        source_sha256 = hashlib.sha256((str(Path(job["source"]).name) + json.dumps(window)).encode("utf-8")).hexdigest()

    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        doc = extract.load_document(job)

    # 底图：整个窗口的模型空间，白底细线。
    base_png, width_pt, height_pt, base_matrix = render_window(doc, window, args.long_edge, kinds=())
    (out / "base.png").write_bytes(base_png)
    base_size = extract.png_pixel_size(base_png)

    # 参考图：同一窗口，只留对应设备层。
    references = []
    for kind, keywords in REFERENCE_KINDS.items():
        png, *_ = render_window(doc, window, args.long_edge, kinds=keywords, reference=True)
        target = out / f"ref-{kind}.png"
        target.write_bytes(png)
        references.append({"kind": kind, "file": target.name, "width": extract.png_pixel_size(png)[0], "height": extract.png_pixel_size(png)[1]})

    # 点位：同一窗口内的全部设备图块，按图层归类。楼层是“一个窗口”，
    # 不是“一页一类别”，所以不再按图名逐页过滤——那会把灯具/开关漏掉。
    points, warnings, seen = [], [], collections.Counter()
    found = window_points(doc, window, base_matrix, (width_pt, height_pt), kinds=(), allowed=None)
    if not found:
        warnings.append("该窗口内没有可命名的设备图块；请确认这个布局是否含灯具/开关图块。")
    for item in found:
        seen[item["iconId"]] += 1
        code_prefix = extract.CODE_PREFIX.get(item["iconId"], "P")
        code = f"{code_prefix}-{seen[item['iconId']]:03d}"
        points.append({"id": f"floor-1-{code}", "name": f"{extract.ICON_LABEL.get(item['iconId'], item['iconId'])} {code}",
                       "room": "未分房间", "iconId": item["iconId"], "status": "planned", "x": item["x"], "y": item["y"],
                       "productId": "", "note": "", "placed": False, "floorId": "floor-1", "code": code,
                       "source": "analysis", "confidence": "medium",
                       "reviewReason": f"按图层“{item['layer']}”归类为{extract.ICON_LABEL.get(item['iconId'], item['iconId'])}；房间归属、具体型号与安装位置需人工复核。"})

    floor = {"id": "floor-1", "name": name, "floorplanName": "base.png",
             "floorplanDataUrl": "data:image/png;base64," + base64.b64encode(base_png).decode("ascii"),
             "imageWidth": base_size[0], "imageHeight": base_size[1],
             "cad": {"format": "cadcraft", "version": 1,
                     "drawingId": f"{name}-{'-'.join(ids)}"[:120],
                     "drawingSha256": source_sha256,
                     "window": window},
             "sourcePage": int("".join(ch for ch in ids[0] if ch.isdigit()) or 1)}
    draft = {"format": "fmkj-point-map-draft", "version": 1, "coordinateSystem": "image-percent",
             "floors": [floor], "points": points, "scenes": []}
    (out / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")

    # 叠点核验图：底图上画点，便于人工确认位置。
    if points:
        extract.write_overlay(out / "base.png", points, out / "overlay.png")

    summary = {"floor": name, "window": [round(v, 1) for v in window], "pages": ids,
               "base": {"file": "base.png", "width": base_size[0], "height": base_size[1]},
               "references": [r["file"] for r in references],
               "points": len(points), "byIcon": dict(seen), "warnings": warnings,
               "seconds": round(time.perf_counter() - started, 2)}
    (out / "floor.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    # 点位清单：给人工核对与后续排查用，不参与导入。
    (out / "points.json").write_text(json.dumps([{"code": p["code"], "iconId": p["iconId"], "x": p["x"], "y": p["y"], "id": p["id"]} for p in points], ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
