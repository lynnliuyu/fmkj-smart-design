"""Content-stream and pixel equivalence checks for buffered PDF operators."""
import unittest
import ezdxf
import fitz
from ezdxf.addons.drawing import Frontend, RenderContext, layout, pymupdf, recorder
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy
from ezdxf.math import BoundingBox2d
from pdf_backend import BufferedPdfBackend


class PdfBackendTest(unittest.TestCase):
    def test_buffering_preserves_paths_masks_opacity_and_clipping(self):
        doc = ezdxf.new()
        model = doc.modelspace()
        for i in range(200):
            model.add_line((i % 100, 0), (100 - i % 100, 70), dxfattribs={"true_color": 0x224466})
        hatch = model.add_hatch(color=3)
        hatch.paths.add_polyline_path([(15, 15), (85, 15), (85, 55), (15, 55)], is_closed=True)
        hatch.paths.add_polyline_path([(30, 25), (70, 25), (70, 45), (30, 45)], is_closed=True, flags=0)
        model.add_solid([(10, 10), (50, 10), (10, 30), (50, 30)], dxfattribs={"true_color": 0xFFFFFF})
        model.add_circle((50, 35), 22, dxfattribs={"true_color": 0xFF0000, "transparency": 0x02000080})
        pattern = model.add_hatch()
        pattern.set_pattern_fill("ANSI31", scale=0.1)
        pattern.paths.add_polyline_path([(0, 0), (100, 0), (100, 70), (0, 70)], is_closed=True)
        model.add_text("Plan 123", dxfattribs={"height": 6, "insert": (20, 30)})
        drawing = recorder.Recorder()
        Frontend(RenderContext(doc), drawing, config=Configuration(background_policy=BackgroundPolicy.WHITE)).draw_layout(model)
        backends = [pymupdf.PyMuPdfBackend(), BufferedPdfBackend()]
        images, streams = [], []
        for backend in backends:
            drawing.player().copy().replay(backend)
            data = backend.get_pdf_bytes(layout.Page(200, 140), render_box=BoundingBox2d([(5, 5), (95, 65)]), settings=layout.Settings(crop_at_margins=True))
            with fitz.open(stream=data, filetype="pdf") as pdf:
                images.append(pdf[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).samples)
                streams.append(pdf[0].read_contents())
        self.assertEqual(streams[0], streams[1])
        self.assertEqual(images[0], images[1])


if __name__ == "__main__":
    unittest.main()
