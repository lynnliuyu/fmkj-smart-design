"""Optional local renderer regression: original target + XCLIP + status=1 viewport."""
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import ezdxf
from ezdxf.xclip import XClip
from PIL import Image

spec = importlib.util.spec_from_file_location("renderer", Path(__file__).with_name("render-clipped-review.py"))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class ClippedReviewTest(unittest.TestCase):
    def test_old_hatch_transform_library_is_refused_before_reading_source(self):
        with patch.object(ezdxf, "version", (1, 4, 4, "release")):
            with self.assertRaisesRegex(ValueError, "ezdxf 1.4.5"):
                renderer.render_review({"source": "does-not-exist.dxf"})

    def test_target_and_clip_survive_offline_rendering(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            doc = ezdxf.new()
            block = doc.blocks.new("clipped-detail")
            block.add_line((0, 0), (200, 0), dxfattribs={"true_color": 0xFF0000})
            insert = doc.modelspace().add_blockref(block.name, (1000, 2000))
            XClip(insert).set_wcs_clipping_path([(1000, 1995), (1050, 2005)])
            paper = doc.layouts.new("detail")
            vp = paper.add_viewport(center=(100, 50), size=(200, 100), view_center_point=(25, 0), view_height=100, status=1)
            vp.dxf.view_target_point = (1000, 2000, 0)
            path = root / "source.dxf"
            doc.saveas(path)
            page = {"id":"detail", "space":"detail", "kind":"sheet", "bounds":[[0,0],[200,100]], "viewports":[{"handle":vp.dxf.handle}], "pdf":"detail.pdf", "png":"detail.png", "originalPdf":"detail.original.pdf", "originalPng":"detail.original.png"}
            result = renderer.render_review({"source":str(path),"outDir":str(root),"colorMode":"readable","expectedSpatialFilters":1,"pages":[page]})
            self.assertGreater(result[0]["records"],0)
            self.assertEqual(result[0]["ezdxfVersion"], ezdxf.__version__)
            image = Image.open(root / "detail.png").convert("RGB")
            w,h = image.size
            # Find the rendered line near page centre; outside XCLIP must stay white.
            strip = image.crop((int(w*.45),h//2-5,int(w*.55),h//2+5))
            self.assertLess(min(strip.convert("L").getdata()),100)
            self.assertEqual(image.getpixel((int(w*.75),h//2)),(255,255,255))
            self.assertEqual(image.getpixel((int(w*.2),h//2)),(255,255,255))


if __name__ == "__main__":
    unittest.main()
