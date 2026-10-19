export type ProductImagePixels = {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type ProductImageBounds = { x: number; y: number; width: number; height: number }

/**
 * Remove an opaque white/transparent matte only when it is connected to the
 * image edge. Product bodies that are white but enclosed by a shadow/outline
 * stay intact. The input buffer is never mutated.
 */
export function stripProductImageMatte(image: ProductImagePixels): ProductImagePixels {
  validatePixels(image)
  const { data, width, height } = image
  const total = width * height
  const matte = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const border = (x: number, y: number) => {
    const index = y * width + x
    if (matte[index] || !isMattePixel(data, index * 4)) return
    matte[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x++) {
    border(x, 0)
    if (height > 1) border(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    border(0, y)
    if (width > 1) border(width - 1, y)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) visit(index - 1)
    if (x + 1 < width) visit(index + 1)
    if (y > 0) visit(index - width)
    if (y + 1 < height) visit(index + width)
  }
  function visit(index: number) {
    if (matte[index] || !isMattePixel(data, index * 4)) return
    matte[index] = 1
    queue[tail++] = index
  }

  // If the visible subject itself touches the edge, cropping/matting is not
  // safe. Keep the original so a flush-mounted white device is not erased.
  for (let x = 0; x < width; x++) {
    if (isVisibleSubject(data, x * 4) || isVisibleSubject(data, ((height - 1) * width + x) * 4)) return image
  }
  for (let y = 1; y < height - 1; y++) {
    if (isVisibleSubject(data, (y * width) * 4) || isVisibleSubject(data, (y * width + width - 1) * 4)) return image
  }

  let subjectPixels = 0
  for (let index = 0; index < total; index++) {
    if (!matte[index] && isVisibleSubject(data, index * 4)) subjectPixels++
  }
  // A completely blank white/transparent asset is not a product photo. Keep
  // it unchanged so callers can still show their category fallback.
  if (!subjectPixels) return image

  const next = new Uint8ClampedArray(data)
  let changed = false
  for (let index = 0; index < total; index++) {
    if (!matte[index]) continue
    const alphaOffset = index * 4 + 3
    if (next[alphaOffset] !== 0) {
      next[alphaOffset] = 0
      changed = true
    }
  }
  // Native ImageData exposes dimensions as prototype getters, so spreading
  // it drops width/height and produces NaN source rectangles in the renderer.
  return changed ? { width, height, data: next } : image
}

/** Find a conservative source rectangle; the caller keeps the original image and aspect ratio. */
export function findProductImageBounds(image: ProductImagePixels): ProductImageBounds {
  validatePixels(image)
  // JPEG product photos frequently have a 250-level matte rather than exact
  // white. Strip only edge-connected matte pixels before measuring the frame;
  // enclosed white device faces remain opaque.
  const normalized = stripProductImageMatte(image)
  const { data, width, height } = normalized
  const fullImage = { x: 0, y: 0, width, height }
  let borderCount = 0
  let transparentBorderCount = 0
  let whiteBorderCount = 0
  function isWhite(offset: number) {
    // A 254-level edge may be the only boundary of a white switch/AP body.
    // Uncertain off-white backgrounds stay uncropped rather than losing it.
    return data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255
  }
  function inspectBorder(x: number, y: number) {
    const offset = (y * width + x) * 4
    borderCount++
    if (data[offset + 3] <= 8) transparentBorderCount++
    else if (isWhite(offset)) whiteBorderCount++
  }
  for (let x = 0; x < width; x++) {
    inspectBorder(x, 0)
    if (height > 1) inspectBorder(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    inspectBorder(0, y)
    if (width > 1) inspectBorder(width - 1, y)
  }
  const transparentMatte = transparentBorderCount / borderCount >= 0.98
  const whiteMatte = !transparentMatte && (transparentBorderCount + whiteBorderCount) / borderCount >= 0.98
  if (!transparentMatte && !whiteMatte) return fullImage

  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (data[offset + 3] <= 8 || (whiteMatte && isWhite(offset))) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return fullImage
  const paddingX = Math.max(1, Math.ceil((right - left + 1) * 0.04))
  const paddingY = Math.max(1, Math.ceil((bottom - top + 1) * 0.04))
  const x = Math.max(0, left - paddingX)
  const y = Math.max(0, top - paddingY)
  return {
    x,
    y,
    width: Math.min(width, right + paddingX + 1) - x,
    height: Math.min(height, bottom + paddingY + 1) - y,
  }
}

function validatePixels({ data, width, height }: ProductImagePixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new RangeError("商品图片像素尺寸与数据不匹配。")
  }
}

function isMattePixel(data: Uint8ClampedArray, offset: number) {
  const alpha = data[offset + 3]
  if (alpha <= 8) return true
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  // Exact white and compressed 248–252 JPEG halos are matte candidates;
  // near-white 253–254 device faces remain protected by the bounds pass.
  const white = red === 255 && green === 255 && blue === 255
  const jpegWhite = red >= 248 && red <= 252 && green >= 248 && green <= 252 && blue >= 248 && blue <= 252
  return (white || jpegWhite) && Math.max(red, green, blue) - Math.min(red, green, blue) <= 6
}

function isVisibleSubject(data: Uint8ClampedArray, offset: number) {
  return data[offset + 3] > 8 && !isMattePixel(data, offset)
}
