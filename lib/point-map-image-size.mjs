/** One proportional drawing size for CAD bases and application exports. */
export const POINT_MAP_IMAGE_LONG_EDGE = 3000;
export const POINT_MAP_EDITOR_LONG_EDGE = 1500;
export const POINT_MAP_EDITOR_SYMBOL_SIZE = 32;
// Editing uses screen pixels; publication uses a fixed image-space symbol size.
export const POINT_MAP_EXPORT_SYMBOL_SIZE = 56;
export const POINT_MAP_EDITOR_HIT_SIZE = 44;

export function pointMapImageSize(width, height, longEdge = POINT_MAP_IMAGE_LONG_EDGE) {
  if (![width, height, longEdge].every(Number.isFinite) || Math.min(width, height, longEdge) <= 0) throw new Error("底图尺寸必须为有效正数。");
  const scale = longEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The camera scales the drawing; markerScale compensates UI symbols in screen space. */
export function pointMapEditorGeometry(image, viewport) {
  const size = pointMapImageSize(image.width, image.height, POINT_MAP_EDITOR_LONG_EDGE);
  const fitScale = Math.max(.001, Math.min(Math.max(1, viewport.width - 24) / size.width, Math.max(1, viewport.height - 24) / size.height));
  return { ...size, fitScale, markerScale: 1 / fitScale };
}
