import { describe, expect, it } from "vitest"

import { deviceTypes, findDeviceType, missingRequiredDeviceSpecs, validateDeviceSpecs } from "../lib/device-types"
import { specValueLabel } from "../lib/device-spec-labels"

/**
 * 2026-10-23 按用户决定把一批自由文本参数改成枚举（外观/电气/光谱/芯数），并新增了
 * 颜色、材质、供电电压等属性。这些测试锁住三件事：
 *   1) 枚举只收合法值（写错了会被拒绝，不是悄悄存进去）；
 *   2) 老数据里已经在用的写法仍然合法（desktop/wall/ceiling 等），不能把现有数据判死；
 *   3) 每个枚举值都有中文显示，客户不会在报价单上看到英文记号。
 */
describe("参数枚举（2026-10-23 规范化）", () => {
  it("墙壁开关：颜色/材质/供电电压已纳入，且枚举收口", () => {
    const type = findDeviceType("wall-switch")!
    const keys = type.specs.map((spec) => spec.key)

    expect(keys).toContain("color")
    expect(keys).toContain("material")
    expect(keys).toContain("rated_voltage_v")

    // 合法值能过
    expect(validateDeviceSpecs("wall-switch", { button_count: 2, relay_count: 1, wiring: "neutral", color: "white", material: "glass" }).errors).toEqual([])
    // 乱写的颜色被拒绝
    const bad = validateDeviceSpecs("wall-switch", { button_count: 2, relay_count: 1, wiring: "neutral", color: "香槟金偏粉" })
    expect(bad.errors.some((message) => message.includes("颜色"))).toBe(true)
  })

  it("灯具：光谱类型、接线芯数、驱动与调光都成了枚举", () => {
    const type = findDeviceType("downlight")!
    const byKey = new Map(type.specs.map((spec) => [spec.key, spec]))

    for (const key of ["spectrum", "wire_count", "driver", "dimming", "color", "material", "rated_voltage_v"]) {
      expect(byKey.has(key), `筒灯应该有待补的参数 ${key}`).toBe(true)
    }
    expect(byKey.get("spectrum")!.values).toContain("full-spectrum")
    expect(byKey.get("spectrum")!.values).toContain("dual-cct")
    expect(byKey.get("wire_count")!.values).toContain("3-wire")

    expect(validateDeviceSpecs("downlight", { power: "ac-mains", spectrum: "full-spectrum", wire_count: "3-wire" }).errors).toEqual([])
    expect(validateDeviceSpecs("downlight", { power: "ac-mains", spectrum: "全光谱" }).errors.length).toBeGreaterThan(0)
  })

  it("安装方式改成枚举，但老数据里的写法仍然合法", () => {
    // 库里历史值：desktop / wall / ceiling / portable / panel / rack
    for (const legacy of ["desktop", "wall", "ceiling", "portable", "panel", "rack"]) {
      const result = validateDeviceSpecs("camera", { environment: "indoor", power: "poe", network: "ethernet", installation: legacy })
      expect(result.errors, `历史写法 ${legacy} 不该被判无效`).toEqual([])
    }
  })

  it("每个枚举值都有中文显示（客户看到的不是英文记号）", () => {
    for (const type of ["wall-switch", "downlight", "camera"].map((id) => findDeviceType(id)!)) {
      for (const spec of type.specs) {
        for (const value of spec.values ?? []) {
          expect(specValueLabel(value), `${spec.key}=${value} 缺少中文显示`).not.toBe(value)
        }
      }
    }
  })
})

/**
 * 必填规则（用户 2026-10-23 定）：**只有点位规划/自动报价必需的参数才是必填**。
 *
 * 代码上落成一条中央规则：必填 ⟺ 标了 requiredForPoint（点位里必须指定的那些）。
 * 这样「填了更清楚、缺了照样能出方案」的信息不会再挡住选型；
 * 而墙壁开关的按键数/继电器路数/接线方式这类配型依据仍然是必填。
 */
describe("必填规则：必填 ⟺ 点位必需", () => {
  const requiredKeys = (id: string) => (findDeviceType(id)?.specs ?? []).filter((spec) => spec.required).map((spec) => spec.key)
  const pointKeys = (id: string) => (findDeviceType(id)?.specs ?? []).filter((spec) => spec.requiredForPoint).map((spec) => spec.key)

  it("每种设备类型：必填项恰好等于点位必需项", () => {
    for (const type of deviceTypes) {
      expect(requiredKeys(type.id).sort(), `${type.name} 的必填项应等于点位必需项`).toEqual(pointKeys(type.id).sort())
    }
  })

  it("墙壁开关：按键数、继电器路数、接线方式必填（配型依据）", () => {
    expect(requiredKeys("wall-switch").sort()).toEqual(["button_count", "relay_count", "wiring"])
  })

  it("灯具：没有必填项（功率/调光/开孔都只是「更清楚」）", () => {
    for (const id of ["downlight", "spotlight", "ceiling-light", "light-strip", "smart-bulb"]) {
      expect(requiredKeys(id), `${id} 不该有必填项`).toEqual([])
    }
    expect(missingRequiredDeviceSpecs("downlight", { power: "ac-mains" })).toEqual([])
  })

  it("无线 AP：供电方式与安装方式必填（点位要按这两种配型）", () => {
    expect(requiredKeys("wireless-ap").sort()).toEqual(["installation", "power"])
  })
})
