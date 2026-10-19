import { describe, expect, it } from "vitest"
import { findProductImageBounds, stripProductImageMatte } from "../lib/product-image-framing"

type Rgba = readonly [number, number, number, number]

function pixels(width: number, height: number, fill: Rgba) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) data.set(fill, index)
  return { data, width, height }
}

function rectangle(image: ReturnType<typeof pixels>, x: number, y: number, width: number, height: number, fill: Rgba) {
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) dataAt(image, column, row, fill)
  }
}

function dataAt(image: ReturnType<typeof pixels>, x: number, y: number, fill: Rgba) {
  image.data.set(fill, (y * image.width + x) * 4)
}

describe("product image framing", () => {
  it("keeps dimensions from native ImageData prototype getters after matting", () => {
    const source = pixels(100, 80, [255, 255, 255, 255])
    rectangle(source, 30, 20, 40, 40, [90, 110, 130, 255])
    const nativePixels = Object.create({
      get data() { return source.data },
      get width() { return source.width },
      get height() { return source.height },
    })

    const normalized = stripProductImageMatte(nativePixels)
    expect(normalized.width).toBe(100)
    expect(normalized.height).toBe(80)
    expect(findProductImageBounds(nativePixels)).toEqual({ x: 28, y: 18, width: 44, height: 44 })
  })

  it("removes a compressed near-white JPEG matte without changing the source buffer", () => {
    const image = pixels(100, 80, [250, 250, 250, 255])
    rectangle(image, 30, 20, 40, 40, [90, 110, 130, 255])
    const original = image.data.slice()

    const normalized = stripProductImageMatte(image)

    expect(normalized).not.toBe(image)
    expect(normalized.data).not.toEqual(original)
    expect(normalized.data[(0 * 100 + 0) * 4 + 3]).toBe(0)
    expect(normalized.data[(40 * 100 + 50) * 4 + 3]).toBe(255)
    expect(findProductImageBounds(image)).toEqual({ x: 28, y: 18, width: 44, height: 44 })
  })

  it("keeps an enclosed nearly white device face while removing its matte", () => {
    const image = pixels(100, 80, [250, 250, 250, 255])
    rectangle(image, 25, 15, 50, 50, [253, 253, 253, 255])
    rectangle(image, 47, 38, 6, 4, [80, 90, 110, 255])

    const normalized = stripProductImageMatte(image)

    expect(normalized.data[(0 * 100 + 0) * 4 + 3]).toBe(0)
    expect(normalized.data[(20 * 100 + 30) * 4 + 3]).toBe(255)
    expect(findProductImageBounds(image)).toEqual({ x: 23, y: 13, width: 54, height: 54 })
  })

  it("frames an opaque white device on transparent PNG margins with breathing room", () => {
    const image = pixels(100, 80, [0, 0, 0, 0])
    rectangle(image, 30, 20, 40, 40, [255, 255, 255, 255])
    const original = image.data.slice()

    expect(findProductImageBounds(image)).toEqual({ x: 28, y: 18, width: 44, height: 44 })
    expect(image.data).toEqual(original)
  })

  it("removes pure-white canvas margins while preserving a nearly white device outline", () => {
    const image = pixels(100, 100, [255, 255, 255, 255])
    rectangle(image, 25, 30, 50, 40, [253, 253, 253, 255])
    rectangle(image, 26, 31, 48, 38, [255, 255, 255, 255])
    rectangle(image, 47, 49, 6, 2, [160, 160, 160, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 23, y: 28, width: 54, height: 44 })
  })

  it("keeps a barely visible white AP body instead of framing only its dark indicator", () => {
    const image = pixels(100, 100, [255, 255, 255, 255])
    rectangle(image, 20, 20, 60, 60, [254, 254, 254, 255])
    rectangle(image, 22, 22, 56, 56, [255, 255, 255, 255])
    rectangle(image, 48, 48, 4, 4, [30, 80, 200, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 17, y: 17, width: 66, height: 66 })
  })

  it.each([
    ["white", [255, 255, 255, 255]],
    ["transparent", [50, 80, 100, 0]],
  ] as const)("keeps the full %s image when there is no visible subject", (_, fill) => {
    expect(findProductImageBounds(pixels(80, 60, fill))).toEqual({ x: 0, y: 0, width: 80, height: 60 })
  })

  it.each([
    ["off-white", [253, 253, 253, 255]],
    ["gray", [220, 220, 220, 255]],
    ["colored", [170, 205, 235, 255]],
  ] as const)("preserves the complete %s photographic background", (_, fill) => {
    const image = pixels(100, 80, fill)
    rectangle(image, 35, 25, 30, 30, [50, 50, 50, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })

  it("preserves the faint transparent silhouette surrounding a white device", () => {
    const image = pixels(100, 80, [12, 45, 90, 0])
    rectangle(image, 30, 20, 40, 30, [255, 255, 255, 16])
    rectangle(image, 35, 25, 30, 20, [255, 255, 255, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 28, y: 18, width: 44, height: 34 })
  })

  it("keeps both ends of a long curtain motor instead of forcing a square crop", () => {
    const image = pixels(400, 100, [255, 255, 255, 255])
    rectangle(image, 50, 40, 300, 20, [120, 125, 130, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 38, y: 39, width: 324, height: 22 })
  })

  it("does not guess a white matte when the device occupies an image border", () => {
    const image = pixels(100, 80, [255, 255, 255, 255])
    rectangle(image, 0, 20, 50, 40, [240, 240, 240, 255])

    expect(findProductImageBounds(image)).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })

  it("rejects dimensions that do not describe the supplied pixel buffer", () => {
    expect(() => findProductImageBounds({ data: new Uint8ClampedArray(4), width: 2, height: 2 })).toThrow(RangeError)
    expect(() => findProductImageBounds({ data: new Uint8ClampedArray(4), width: 0, height: 1 })).toThrow(RangeError)
    expect(() => findProductImageBounds({ data: new Uint8ClampedArray(8), width: 1.5, height: 1 })).toThrow(RangeError)
  })
})
