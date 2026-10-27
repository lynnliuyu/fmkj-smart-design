import { describe, expect, it } from "vitest"

import { needsDirectImageLoad } from "../lib/image-src"

/**
 * 私有附件图必须绕过 Next 的图片优化接口。
 *
 * 真机遇到的 bug：设备版产品图存在 `/api/files/...`（要登录才给看），
 * Next 的 `/_next/image?url=...` 由服务端去取图、不带浏览器会话，于是返回 400，
 * 客户在产品库里看到的是一排破图。这类图只能让浏览器直接请求（带上 Cookie）。
 */
describe("图片加载方式", () => {
  it("私有附件图（/api/files/）要直接加载", () => {
    expect(needsDirectImageLoad("/api/files/product-images/official/a.png")).toBe(true)
    expect(needsDirectImageLoad("/api/files/contracts/b.pdf")).toBe(true)
  })

  it("public 下的普通图片继续走优化器（省流量）", () => {
    expect(needsDirectImageLoad("/assets/products/ruijie/rg-nbc.png")).toBe(false)
  })

  it("SVG 一律直接加载（优化器不处理 SVG）", () => {
    expect(needsDirectImageLoad("/assets/point-icons/v1/switch-1.svg")).toBe(true)
    expect(needsDirectImageLoad("/api/files/x.svg")).toBe(true)
  })

  it("空值不报错", () => {
    expect(needsDirectImageLoad(null)).toBe(false)
    expect(needsDirectImageLoad(undefined)).toBe(false)
    expect(needsDirectImageLoad("")).toBe(false)
  })
})
