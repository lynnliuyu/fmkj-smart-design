import { describe, expect, it } from "vitest"

import { catalogLicenseHash, generateCatalogLicenseKey, safeEqual } from "../lib/catalog-licenses"

/**
 * 一机一密：每台客户设备一份取资料凭据。
 *
 * 库里只存哈希与前缀（备份泄露也拿不去取资料），明文只在创建时给一次；
 * 校验是「哈希查表 + 启用中」，所以停用一台不影响别人。
 */
describe("设备凭据", () => {
  it("生成的凭据形如 fmkj_+32 位十六进制，且每次不同", () => {
    const a = generateCatalogLicenseKey()
    const b = generateCatalogLicenseKey()
    expect(a).toMatch(/^fmkj_[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it("哈希稳定、不泄露明文、前后空格不影响", () => {
    const key = generateCatalogLicenseKey()
    expect(catalogLicenseHash(key)).toBe(catalogLicenseHash(key))
    expect(catalogLicenseHash(key)).toHaveLength(64)
    expect(catalogLicenseHash(key)).not.toContain(key.slice(5, 12))
    expect(catalogLicenseHash(` ${key} `)).toBe(catalogLicenseHash(key))
  })

  it("不同凭据哈希不同（不会互相串台）", () => {
    const keys = new Set(Array.from({ length: 50 }, () => catalogLicenseHash(generateCatalogLicenseKey())))
    expect(keys.size).toBe(50)
  })

  it("总钥匙比较用常量时间函数，长度不同直接失败", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("abc", "abd")).toBe(false)
    expect(safeEqual("abc", "abcd")).toBe(false)
    expect(safeEqual("", "")).toBe(true)
  })
})
