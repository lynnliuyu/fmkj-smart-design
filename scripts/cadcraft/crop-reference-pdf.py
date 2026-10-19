"""Remove CADCraft's known PDF paper margins, preserving the exact --window frame."""
import math
import re
import sys
import zlib
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject


def crop_reference(source, output, width, height):
    if not all(math.isfinite(n) and n > 0 for n in (width, height)):
        raise ValueError("Invalid CAD window")
    reader = PdfReader(source)
    if len(reader.pages) != 1:
        raise ValueError("Expected a single CAD reference page")
    page = reader.pages[0]
    stream = page["/Contents"].get_object()
    if stream.get("/Filter") != "/FlateDecode":
        raise ValueError("Unsupported CAD PDF content encoding")
    header = zlib.decompressobj().decompress(stream._data, 4096)
    number = rb"([-+0-9.]+)"
    clip = re.search(number + rb"\s+" + number + rb"\s+" + number + rb"\s+" + number + rb"\s+re\s+W\s+n", header)
    if not clip:
        raise ValueError("Missing CADCraft page clip; refusing to guess image alignment")
    x, y, available_width, available_height = map(float, clip.groups())
    scale = min(available_width / width, available_height / height)
    drawn_width, drawn_height = width * scale, height * scale
    left, bottom = x + (available_width - drawn_width) / 2, y + (available_height - drawn_height) / 2
    box = RectangleObject([left, bottom, left + drawn_width, bottom + drawn_height])
    page.mediabox = box
    page.cropbox = box
    writer = PdfWriter()
    writer.add_page(page)
    with open(output, "xb") as target:
        writer.write(target)


if __name__ == "__main__":
    crop_reference(sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
