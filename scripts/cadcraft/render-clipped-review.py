"""Render original DXF with VIEWPORT targets, frozen layers and XCLIP intact.

CADCraft 0.5 drops block spatial filters. This local fallback uses ezdxf's
clipping pipeline, records geometry once, and replays both paper palettes.
"""
import json
import logging
import sys
import time
from pathlib import Path

import ezdxf
import fitz
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout, recorder
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy
from ezdxf.addons.drawing.frontend import _find_image_path
from ezdxf.math import BoundingBox, BoundingBox2d
from pdf_backend import BufferedPdfBackend

logging.getLogger("ezdxf").setLevel(logging.ERROR)


def paper_palette(properties):
    color = properties.color
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    if min(rgb) >= 254:
        mapped = "#ffffff"  # Preserve white masks and wipeouts.
    else:
        gray = min(rgb[0], 115) if max(rgb) - min(rgb) <= 1 else 30
        mapped = "#" + f"{gray:02x}" * 3
    return recorder.Override(properties._replace(color=mapped + color[7:]))


def render_review(job):
    if ezdxf.version < (1, 4, 5, "release"):
        raise ValueError("裁剪导出需要 ezdxf 1.4.5 或更新版本；旧版图块填充变换会重复缩放，请按 render-requirements.txt 更新依赖。")
    doc = ezdxf.readfile(job["source"])
    clips = sum(e.dxftype() == "SPATIAL_FILTER" for e in doc.entitydb.values())
    if clips < job.get("expectedSpatialFilters", 0):
        raise ValueError("Original block clipping data was lost; refusing incomplete export")
    # LibreDWG's DXF writer preserves paper blocks but may omit the layout dictionary.
    for item in job.get("sourceLayouts", []):
        if item["name"] == "Model":
            continue
        source = doc.blocks.get(item["blockName"])
        target = doc.layouts.get(item["name"]) if item["name"] in doc.layouts else doc.layouts.new(item["name"])
        if source.block_record.dxf.handle != target.block_record.dxf.handle:
            for entity in list(source):
                source.move_to_layout(entity, target)
    font = Path(job.get("fallbackFont", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"))
    if not font.is_file():
        raise ValueError("Missing local CJK fallback font: " + str(font))
    for style in doc.styles:
        # Legacy CAD SHX files are not bundled; use a local font with Chinese glyphs.
        style.dxf.font = str(font)
        style.dxf.bigfont = ""
    image_files = {e.image_def.dxf.filename for e in doc.entitydb.values() if e.dxftype() == "IMAGE" and e.image_def is not None and e.dxf.flags & 1}
    missing_images = [name for name in image_files if not _find_image_path(Path(job["source"]).parent, name).is_file()]
    quality_warnings = ["裁剪渲染使用本机中文替代字体，原 SHX 字形与文字宽度需复核。"]
    if missing_images:
        quality_warnings.append(f"源图引用 {len(missing_images)} 个未随图纸提供的外部图片文件，相关图片无法还原。")
    root = Path(job["outDir"])
    cache = bbox.Cache()
    config = Configuration(background_policy=BackgroundPolicy.WHITE)
    cameras = set(job.get("paperCameraHandles", []))
    results = []
    for page in job["pages"]:
        print("Rendering " + page["id"], flush=True)
        space = doc.layouts.get(page["space"])
        active = {v["handle"].upper() for v in page.get("viewports", [])}
        if page["kind"] == "overview" and page["space"] != "Model":
            active = {e.dxf.handle.upper() for e in space if e.dxftype() == "VIEWPORT" and (e.dxf.handle.upper() not in cameras if cameras else e.dxf.id != 1)}
        for handle in active:
            # Some source files give every floating viewport status=1. ezdxf treats
            # the first status=1 camera as the paper overview and skips it.
            doc.entitydb[handle].dxf.status = 2
        bounds = page.get("bounds")
        box = BoundingBox(bounds) if bounds else None

        def keep(entity):
            if entity.dxftype() == "VIEWPORT":
                return entity.dxf.handle.upper() in active
            if box is None:
                return True
            extent = bbox.extents([entity], fast=True, cache=cache)
            # Keep unknown bounds for review, rather than silently dropping content.
            return not extent.has_data or extent.has_overlap(box)

        drawing = recorder.Recorder()
        started = time.perf_counter()
        print("CAD_STAGE " + page["id"] + " · 正在解析可见几何与裁剪…", flush=True)
        Frontend(RenderContext(doc), drawing, config=config, bbox_cache=cache).draw_layout(space, filter_func=keep)
        drawing_seconds = time.perf_counter() - started
        player = drawing.player()
        render_box = BoundingBox2d(bounds) if bounds else player.bbox()
        if not render_box.has_data:
            raise ValueError("No renderable content: " + page["id"])
        if job.get("previewOnly"):
            # Fast single-colour preview: only the readable page and its PNG.
            modes = [(page["pdf"], page["png"], paper_palette)] if job["colorMode"] == "readable" else [(page["pdf"], page["png"], None)]
        else:
            modes = [(page["originalPdf"], page["originalPng"], None), (page["pdf"], page["png"], paper_palette)] if job["colorMode"] == "readable" else [(page["pdf"], page["png"], None)]
        for pdf_name, png_name, palette in modes:
            print("CAD_STAGE " + page["id"] + " · 正在生成 " + pdf_name + "…", flush=True)
            backend = BufferedPdfBackend()
            player.copy().replay(backend, override=palette)
            pdf = backend.get_pdf_bytes(layout.Page(420, 297), render_box=render_box, settings=layout.Settings(crop_at_margins=True))
            (root / pdf_name).write_bytes(pdf)
            print("CAD_STAGE " + page["id"] + " · 正在生成高清 PNG…", flush=True)
            with fitz.open(stream=pdf, filetype="pdf") as document:
                scale = job.get("imageLongEdge", 3000) / max(document[0].rect.width, document[0].rect.height)
                document[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(root / png_name)
        results.append({"id": page["id"], "records": len(player.records), "spatialFilters": clips, "ezdxfVersion": ezdxf.__version__, "pymupdfVersion": fitz.VersionBind, "drawingSeconds": drawing_seconds, "totalSeconds": time.perf_counter() - started, "warnings": quality_warnings if not results else []})
        print("Done " + page["id"], flush=True)
    return results


if __name__ == "__main__":
    job = json.loads(Path(sys.argv[1]).read_text())
    result = render_review(job)
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2))
