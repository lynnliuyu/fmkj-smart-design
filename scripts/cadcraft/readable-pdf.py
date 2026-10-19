"""Apply a paper-reading palette to CADCraft's native vector PDF content.

Only complete color-operator lines in page content are changed. Geometry,
text outlines, clipping, line widths, images and white knockout fills survive.
Streaming avoids expanding dense CAD hatch streams into Python PDF operators.
"""
import re
import sys
import zlib
from pathlib import Path

from pypdf import PdfReader, PdfWriter, filters
from pypdf.generic import ArrayObject, EncodedStreamObject, NameObject

# Dense hatch geometry can expand far beyond its compressed PDF size.
# Process bounded chunks, while retaining a finite total-work limit.
MAX_BYTES = 4_000_000_000
filters.MAX_DECLARED_STREAM_LENGTH = 1_000_000_000
NUMBER = rb"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
COLOR = re.compile(rb"^(" + NUMBER + rb"(?:[ \t]+" + NUMBER + rb"){0,3})[ \t]+(rg|RG|g|G|k|K)[ \t]*\r?$", re.M)


def paper_color(match):
    values = [float(value) for value in match[1].split()]
    op = match[2]
    if len(values) != {b"rg": 3, b"RG": 3, b"g": 1, b"G": 1, b"k": 4, b"K": 4}[op]:
        return match[0]
    if op.isupper():
        return b"0 G"  # Construction strokes stay visible on white paper.
    if op == b"rg":
        white = min(values) >= 0.999
        achromatic = max(values) - min(values) < 0.001
        gray = min(values[0], 0.45) if achromatic else 0.15
    elif op == b"g":
        white = values[0] >= 0.999
        gray = min(values[0], 0.45)
    else:
        white = max(values) <= 0.001
        gray = 0.15
    return b"1 g" if white else f"{gray:.4f} g".encode("ascii")


def recolor_stream(stream):
    codec = stream.get("/Filter")
    if isinstance(codec, ArrayObject) and len(codec) == 1:
        codec = codec[0]
    if codec not in (None, "/FlateDecode") or stream.get("/DecodeParms"):
        raise ValueError("Unsupported CAD content encoding; original PDF preserved")
    decoder = zlib.decompressobj() if codec else None
    compressor = zlib.compressobj()
    result, pending, size = bytearray(), b"", 0
    encoded = stream._data
    for offset in range(0, len(encoded), 256 * 1024):
        block = encoded[offset:offset + 256 * 1024]
        block = decoder.decompress(block, MAX_BYTES + 1 - size) if decoder else block
        size += len(block)
        if size > MAX_BYTES or (decoder and decoder.unconsumed_tail):
            raise ValueError("CAD content exceeds reading-palette size limit")
        pending += block
        end = pending.rfind(b"\n") + 1
        result.extend(compressor.compress(COLOR.sub(paper_color, pending[:end])))
        pending = pending[end:]
        if len(pending) > 1024 * 1024:
            raise ValueError("Unexpected CAD content line length")
    if decoder:
        pending += decoder.flush()
        if not decoder.eof:
            raise ValueError("Truncated CAD PDF content")
    result.extend(compressor.compress(COLOR.sub(paper_color, pending)))
    result.extend(compressor.flush())
    output = EncodedStreamObject()
    output._data = bytes(result)
    output[NameObject("/Filter")] = NameObject("/FlateDecode")
    return output


def make_readable(source, output):
    reader, writer = PdfReader(source), PdfWriter()
    for page in reader.pages:
        contents = page.get("/Contents")
        if contents:
            contents = contents.get_object()
            streams = contents if isinstance(contents, ArrayObject) else [contents]
            mapped = [recolor_stream(stream.get_object()) for stream in streams]
            page[NameObject("/Contents")] = mapped[0] if len(mapped) == 1 else ArrayObject(mapped)
        writer.add_page(page)
    with Path(output).open("xb") as target:
        writer.write(target)


if __name__ == "__main__":
    make_readable(sys.argv[1], sys.argv[2])
