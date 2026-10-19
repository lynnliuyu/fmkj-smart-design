/** Shared by CAD preparation and the browser; coordinates are source-image pixels. */
export const FLOORPLAN_CROP_PADDING = 0.03;

export function validateFloorplanCrop(crop, width, height) {
  if (![width, height, crop?.left, crop?.top, crop?.width, crop?.height].every(Number.isFinite) ||
    ![width, height, crop.left, crop.top, crop.width, crop.height].every(Number.isInteger) ||
    width <= 0 || height <= 0 || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 ||
    crop.left + crop.width > width || crop.top + crop.height > height)
    throw new Error("底图裁切范围无效。");
  return crop;
}

/** Keep every visible pixel, including pale lines; interior white rooms are never removed. */
export function findFloorplanCrop(data, width, height, channels = 4) {
  if (![width, height].every(Number.isInteger) || width <= 0 || height <= 0 || width * height > 36_000_000 ||
    ![3, 4].includes(channels) || data.length !== width * height * channels)
    throw new Error("底图像素或尺寸无效，最多支持 3600 万像素。");
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const alpha = channels === 4 ? data[i + 3] / 255 : 1;
    if (Math.min(data[i], data[i + 1], data[i + 2]) * alpha + 255 * (1 - alpha) >= 245) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("底图没有可识别的图形，未进行裁切。");
  const padX = Math.ceil((right - left + 1) * FLOORPLAN_CROP_PADDING);
  const padY = Math.ceil((bottom - top + 1) * FLOORPLAN_CROP_PADDING);
  const x0 = Math.max(0, left - padX), y0 = Math.max(0, top - padY);
  return { left: x0, top: y0, width: Math.min(width, right + 1 + padX) - x0, height: Math.min(height, bottom + 1 + padY) - y0 };
}

export function cropPercentPosition(point, crop, width, height) {
  validateFloorplanCrop(crop, width, height);
  return { x: (point.x * width - crop.left * 100) / crop.width, y: (point.y * height - crop.top * 100) / crop.height };
}

export function cropCadWindow(window, crop, width, height) {
  validateFloorplanCrop(crop, width, height);
  const dx = window[2] - window[0], dy = window[3] - window[1];
  return [window[0] + crop.left / width * dx, window[3] - (crop.top + crop.height) / height * dy,
    window[0] + (crop.left + crop.width) / width * dx, window[3] - crop.top / height * dy];
}
