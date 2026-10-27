import { describe, expect, it } from "vitest"

import { SELF_SIGNUP_CLOSED_MESSAGE, selfSignupAllowed } from "../lib/self-signup"

describe("自助注册闸门", () => {
  it("没配置时保持原行为（托管版不受影响）", () => {
    expect(selfSignupAllowed({})).toBe(true)
    expect(selfSignupAllowed({ FMKJ_ALLOW_SELF_SIGNUP: "" })).toBe(true)
    expect(selfSignupAllowed({ FMKJ_ALLOW_SELF_SIGNUP: "true" })).toBe(true)
  })

  it("设备版关掉后，陌生人注册被拒（大小写与常见写法都认）", () => {
    for (const value of ["false", "FALSE", "0", "no", " false "]) {
      expect(selfSignupAllowed({ FMKJ_ALLOW_SELF_SIGNUP: value })).toBe(false)
    }
  })

  it("拒绝时给客户一句人话，不是报错码", () => {
    expect(SELF_SIGNUP_CLOSED_MESSAGE).toMatch(/不开放自助注册/)
    expect(SELF_SIGNUP_CLOSED_MESSAGE).toMatch(/管理员/)
  })
})
