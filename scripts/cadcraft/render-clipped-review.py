"""Render original DXF with VIEWPORT targets, frozen layers and XCLIP intact.

CADCraft 0.5 drops block spatial filters. This local fallback uses ezdxf's
clipping pipeline, records geometry once, and replays both paper palettes.
"""
import json
import logging
import sys
from pathlib import Path

import ezdxf
import fitz
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout, pymupdf, recorder
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy
from ezdxf.math import BoundingBox, BoundingBox2d

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
        Frontend(RenderContext(doc), drawing, config=config, bbox_cache=cache).draw_layout(space, filter_func=keep)
        player = drawing.player()
        render_box = BoundingBox2d(bounds) if bounds else player.bbox()
        if not render_box.has_data:
            raise ValueError("No renderable content: " + page["id"])
        modes = [(page["originalPdf"], page["originalPng"], None), (page["pdf"], page["png"], paper_palette)] if job["colorMode"] == "readable" else [(page["pdf"], page["png"], None)]
        for pdf_name, png_name, palette in modes:
            backend = pymupdf.PyMuPdfBackend()
            player.copy().replay(backend, override=palette)
            pdf = backend.get_pdf_bytes(layout.Page(420, 297), render_box=render_box, settings=layout.Settings(crop_at_margins=True))
            (root / pdf_name).write_bytes(pdf)
            with fitz.open(stream=pdf, filetype="pdf") as document:
                scale = job.get("imageLongEdge", 3000) / max(document[0].rect.width, document[0].rect.height)
                document[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(root / png_name)
        results.append({"id": page["id"], "records": len(player.records), "spatialFilters": clips})
        print("Done " + page["id"], flush=True)
    return results


if __name__ == "__main__":
    job = json.loads(Path(sys.argv[1]).read_text())
    result = render_review(job)
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2))
