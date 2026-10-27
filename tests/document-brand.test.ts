import { describe, expect, it } from "vitest"

import { DOCUMENT_BRAND, resolveDocumentBrand } from "../lib/document-brand"
import { platformSettingDefinitions, validateSettingValue } from "../lib/platform-settings"

describe("报价单上印谁的名字", () => {
  it("客户没填就用默认品牌", () => {
    expect(resolveDocumentBrand()).toEqual({
      address: "",
      companyName: DOCUMENT_BRAND.companyName,
      contact: "",
      logoSrc: DOCUMENT_BRAND.logoSrc,
      qrSrc: "",
    })
    expect(resolveDocumentBrand([]).companyName).toBe(DOCUMENT_BRAND.companyName)
  })

  it("客户填了就用客户的（名字和 logo 各自独立）", () => {
    const settings = [
      { key: "BRAND_NAME", value: "杭州某某智能家居" },
      { key: "BRAND_LOGO_URL", value: "/api/files/company-logos/platform/logo.png" },
    ]
    expect(resolveDocumentBrand(settings)).toMatchObject({
      companyName: "杭州某某智能家居",
      logoSrc: "/api/files/company-logos/platform/logo.png",
    })
    // 只填了名字时，logo 仍然用默认的
    expect(resolveDocumentBrand([{ key: "BRAND_NAME", value: "甲门店" }]).logoSrc).toBe(DOCUMENT_BRAND.logoSrc)
  })

  it("填了空白等于没填——不能让报价单上出现空名字", () => {
    const brand = resolveDocumentBrand([
      { key: "BRAND_NAME", value: "   " },
      { key: "BRAND_LOGO_URL", value: "" },
    ])
    expect(brand.companyName).toBe(DOCUMENT_BRAND.companyName)
    expect(brand.logoSrc).toBe(DOCUMENT_BRAND.logoSrc)
  })

  it("联系方式、地址、二维码都读得到；没填就是空（不印那一行）", () => {
    const brand = resolveDocumentBrand([
      { key: "BRAND_CONTACT", value: "电话 / 微信：13800000000" },
      { key: "BRAND_ADDRESS", value: "杭州市西湖区某路 1 号" },
      { key: "BRAND_QR_URL", value: "/api/files/company-logos/platform/qr.png" },
    ])
    expect(brand).toMatchObject({
      address: "杭州市西湖区某路 1 号",
      contact: "电话 / 微信：13800000000",
      qrSrc: "/api/files/company-logos/platform/qr.png",
    })
    expect(resolveDocumentBrand([])).toMatchObject({ address: "", contact: "", qrSrc: "" })
  })

  it("也接受「键值对」形式（服务端读出来的设置就是数组形式）", () => {
    expect(resolveDocumentBrand({ BRAND_NAME: "乙公司" }).companyName).toBe("乙公司")
  })
})

describe("品牌配置项的校验", () => {


  it("品牌相关字段都在系统配置里", () => {
    const keys = platformSettingDefinitions.map((item) => item.key)
    expect(keys).toEqual(expect.arrayContaining(["BRAND_NAME", "BRAND_LOGO_URL", "BRAND_CONTACT", "BRAND_ADDRESS", "BRAND_QR_URL"]))
  })

  it("logo 允许站内地址与 https，不允许乱七八糟的字符串", () => {
    expect(() => validateSettingValue("BRAND_LOGO_URL", "/api/files/company-logos/platform/a.png")).not.toThrow()
    expect(() => validateSettingValue("BRAND_LOGO_URL", "https://cdn.example.com/logo.png")).not.toThrow()
    // 抛出的错误里带的是错误码；给客户看的中文文案由 platformSettingsErrorResponse 负责
    expect(() => validateSettingValue("BRAND_LOGO_URL", "javascript:alert(1)")).toThrow("INVALID_URL")
    expect(() => validateSettingValue("BRAND_LOGO_URL", "随便一段话")).toThrow("INVALID_URL")
  })

  it("公司名太长会被拦下（报价单上放不下）", () => {
    expect(() => validateSettingValue("BRAND_NAME", "长".repeat(61))).toThrow("TOO_LONG")
    expect(() => validateSettingValue("BRAND_NAME", "正常名字")).not.toThrow()
  })

  it("地址允许比公司名长，但也有上限", () => {
    expect(() => validateSettingValue("BRAND_ADDRESS", "某路".repeat(70))).toThrow("TOO_LONG")
    expect(() => validateSettingValue("BRAND_ADDRESS", "杭州市西湖区某路 1 号 2 楼 201 室")).not.toThrow()
  })

  it("二维码只接受站内地址或 https", () => {
    expect(() => validateSettingValue("BRAND_QR_URL", "/api/files/company-logos/platform/qr.png")).not.toThrow()
    expect(() => validateSettingValue("BRAND_QR_URL", "数据:随便写")).toThrow("INVALID_URL")
  })
})
