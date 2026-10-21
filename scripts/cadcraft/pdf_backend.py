"""Buffer PDF operators without changing their geometry or graphics states.

ezdxf 1.4.4's PyMuPDF backend appends every finished path to one Shape string.
Large architectural overviews repeatedly copy growing strings. Buffer both the
unfinished path and finished content, and commit once just like the original.
Repeated Shape.commit would rescan the entire PDF for balanced graphics states.
"""
from ezdxf.addons.drawing import pymupdf


class PathBuffer:
    """Append path operators without copying the entire unfinished path.

    PyMuPDF 1.26.7 Shape uses += while drawing and concatenation at finish.
    Materialize only at that finish boundary; never split a fill or stroke.
    """
    def __init__(self):
        self.parts = []
        self.length = 0

    def __iadd__(self, value):
        self.parts.append(value)
        self.length += len(value)
        return self

    def __str__(self):
        return "".join(self.parts)

    def __radd__(self, value):
        return value + str(self)

    def __add__(self, value):
        return str(self) + value

    def __eq__(self, value):
        if not isinstance(value, str):
            return NotImplemented
        return self.length == 0 if value == "" else str(self) == value

    def encode(self, *args, **kwargs):
        return str(self).encode(*args, **kwargs)


class BufferedRenderBackend(pymupdf.PyMuPdfRenderBackend):

    def __init__(self, page, settings):
        super().__init__(page, settings)
        self.content_shape.draw_cont = PathBuffer()
        self.content_shape.totalcont = PathBuffer()

    def set_background(self, color):
        super().set_background(color)
        if isinstance(self.content_shape.draw_cont, str):
            self.content_shape.draw_cont = PathBuffer()
        if isinstance(self.content_shape.totalcont, str):
            self.content_shape.totalcont = PathBuffer()

    def finish_line(self, shape, properties, close):
        super().finish_line(shape, properties, close)
        shape.draw_cont = PathBuffer()

    def finish_filling(self, shape, properties):
        super().finish_filling(shape, properties)
        shape.draw_cont = PathBuffer()


class BufferedPdfBackend(pymupdf.PyMuPdfBackend):
    @staticmethod
    def make_backend(page, settings):
        return BufferedRenderBackend(page, settings)

    def get_pdf_bytes(self, page, *, settings=None, render_box=None):
        if settings is None:
            from ezdxf.addons.drawing import layout
            settings = layout.Settings()
        backend = self.get_replay(page, settings=settings, render_box=render_box)
        try:
            return backend.get_pdf_bytes()
        finally:
            backend.doc.close()
