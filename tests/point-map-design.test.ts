import { describe, expect, it } from "vitest"
import {
  activePointMapFloor,
  exportPointMapDraft,
  importPointMapDraft,
  isPristinePointMapTemplate,
  normalizeDesignPlan,
  parsePointMapDraft,
  validateDesignPlan,
  type PointMapDraft
} from "../lib/point-map-design"
import {
  addPointToPlan,
  emptyPointMapPlan,
  movePointInPlan,
  nextPointMapPointCode,
  pointMapStorageKey,
  readPointMapPlan,
  queueProductPoints,
  removePointFromPlan,
  writePointMapPlan,
  type PointMapPlan,
  type PointMapStorage
} from "../lib/point-map-plan"
import { defaultSpacesForPropertyType, type PropertyType } from "../lib/project-spaces"

// A synthetic single-pixel PNG, independent of all customer source files.
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

function draft(): PointMapDraft {
  return {
    format: "fmkj-point-map-draft",
    version: 1,
    coordinateSystem: "image-percent",
    floors: [
      {
        id: "ground",
        name: "一楼",
        floorplanName: "",
        floorplanDataUrl: "",
        imageWidth: 0,
        imageHeight: 0,
        sourcePage: 13
      },
      {
        id: "basement",
        name: "负一楼",
        floorplanName: "synthetic.png",
        floorplanDataUrl: png,
        imageWidth: 1,
        imageHeight: 1,
        sourcePage: 36
      }
    ],
    points: [
      {
        id: "ground-K01",
        floorId: "ground",
        code: "K01",
        name: "玄关开关",
        room: "入户过道",
        iconId: "switch-2",
        x: 12.345,
        y: 61.234,
        status: "confirmed",
        placed: true,
        productId: "suggested-product",
        note: "控制关系需确认",
        controlTargets: ["玄关筒灯", "客厅灯带"],
        controlType: "零火",
        confidence: "medium",
        reviewReason: "原图连线不清晰",
        source: "analysis"
      },
      {
        id: "basement-K01",
        floorId: "basement",
        code: "K01",
        name: "楼梯开关",
        room: "楼梯间",
        iconId: "switch-4",
        x: 82,
        y: 25,
        status: "confirmed",
        placed: true,
        productId: "",
        note: "",
        confidence: "high"
      }
    ],
    scenes: [
      {
        id: "coming-home",
        name: "回家",
        trigger: "点击玄关面板",
        description: "开启玄关与客厅照明",
        pointIds: ["ground-K01", "basement-K01"],
        status: "confirmed"
      }
    ]
  }
}

function plan(): PointMapPlan {
  return importPointMapDraft(
    emptyPointMapPlan("project", () => "2026-10-14T00:00:00Z"),
    draft()
  ).plan
}

function templatePlan(propertyType: PropertyType): PointMapPlan {
  const floors = defaultSpacesForPropertyType(propertyType).map((space) => ({
    id: space.id, name: space.name, floorplanName: "", floorplanDataUrl: "", imageWidth: 0, imageHeight: 0,
  }))
  return normalizeDesignPlan({ ...emptyPointMapPlan("project"), floors, activeFloorId: floors[0].id })
}

describe("point map design data", () => {
  it.each(["flat", "villa"] as const)("replaces untouched %s templates and opens the first imported floor", (propertyType) => {
    const current = templatePlan(propertyType)
    const before = structuredClone(current)
    const incoming = draft()
    incoming.floors[0] = { ...incoming.floors[0], floorplanName: "ground.png", floorplanDataUrl: png, imageWidth: 1, imageHeight: 1 }
    const result = importPointMapDraft(current, incoming)
    expect(result.plan.floors).toEqual(incoming.floors)
    expect(result.plan.activeFloorId).toBe("ground")
    expect(activePointMapFloor(result.plan)?.floorplanDataUrl).toBe(png)
    expect(result).toMatchObject({ added: 2, skipped: 0 })
    expect(current).toEqual(before)
  })

  it("fills a matching untouched template ID instead of dropping its incoming drawing", () => {
    const current = templatePlan("flat")
    const incoming = draft()
    incoming.floors[0] = { ...incoming.floors[1], id: "flat-default", name: "全屋" }
    incoming.floors = [incoming.floors[0]]
    incoming.points = [{ ...incoming.points[0], floorId: "flat-default" }]
    incoming.scenes = []
    const result = importPointMapDraft(current, incoming)
    expect(result.plan.floors).toEqual(incoming.floors)
    expect(result.plan.activeFloorId).toBe("flat-default")
    expect(result.plan.floorplanDataUrl).toBe(png)
  })

  it("merges a matching unused template while preserving populated floors, existing points and active selection", () => {
    const current = templatePlan("villa")
    current.floors![1] = { ...current.floors![1], floorplanName: "existing.png", floorplanDataUrl: png, imageWidth: 1, imageHeight: 1 }
    current.activeFloorId = "villa-1"
    current.points = [{ ...draft().points[0], id: "existing-point", floorId: "villa-1", x: 19, status: "confirmed" }]
    const incoming = draft()
    incoming.floors = [{ ...incoming.floors[1], id: "villa-2", name: "二层" }]
    incoming.points = [{ ...incoming.points[1], floorId: "villa-2" }]
    incoming.scenes = []
    const before = normalizeDesignPlan(current)
    const result = importPointMapDraft(current, incoming)
    expect(result.plan.floors).toHaveLength(5)
    expect(result.plan.floors!.find((floor) => floor.id === "villa-2")).toEqual(incoming.floors[0])
    expect(result.plan.floors!.filter((floor) => floor.id !== "villa-2")).toEqual(before.floors!.filter((floor) => floor.id !== "villa-2"))
    expect(result.plan.points[0]).toEqual(before.points[0])
    expect(result.plan.activeFloorId).toBe("villa-1")
  })

  it.each(["renamed", "rooms", "image", "point"] as const)("preserves a %s system floor and its other template floors", (change) => {
    const current = templatePlan("villa")
    const floor = current.floors![0]
    if (change === "renamed") floor.name = "客户确认地下室"
    if (change === "rooms") floor.rooms = ["酒窖"]
    if (change === "image") Object.assign(floor, { floorplanName: "existing.png", floorplanDataUrl: png, imageWidth: 1, imageHeight: 1 })
    if (change === "point") current.points = [{ ...draft().points[0], id: "existing-point", floorId: floor.id }]
    const before = normalizeDesignPlan(current)
    const result = importPointMapDraft(current, draft())
    expect(result.plan.floors!.slice(0, before.floors!.length)).toEqual(before.floors)
    expect(result.plan.activeFloorId).toBe(before.activeFloorId)
    expect(result.plan.points.slice(0, before.points.length)).toEqual(before.points)
  })

  it("keeps a custom empty user floor, including a matching incoming ID", () => {
    const incoming = draft()
    const userFloor = { ...incoming.floors[0], name: "用户空白图纸", sourcePage: undefined }
    const current = normalizeDesignPlan({ ...emptyPointMapPlan("project"), floors: [userFloor], activeFloorId: userFloor.id })
    incoming.floors[0] = { ...incoming.floors[0], floorplanName: "ground.png", floorplanDataUrl: png, imageWidth: 1, imageHeight: 1 }
    const result = importPointMapDraft(current, incoming)
    expect(result.plan.floors![0]).toEqual(userFloor)
    expect(result.plan.floors).toHaveLength(2)
    expect(result.plan.activeFloorId).toBe(userFloor.id)
  })

  it("fills missing legacy codes without colliding with later explicit codes and keeps assignments stable", () => {
    const template = draft().points[0]
    const legacy: PointMapPlan = {
      ...emptyPointMapPlan("project"),
      points: [
        { ...template, id: "missing-first", floorId: undefined, code: undefined },
        { ...template, id: "explicit-one", floorId: undefined, code: "P001" },
        { ...template, id: "missing-blank", floorId: undefined, code: " " },
        { ...template, id: "explicit-three", floorId: undefined, code: "P003" }
      ]
    }
    const before = structuredClone(legacy)
    const normalized = normalizeDesignPlan(legacy)
    expect(normalized.points.map((point) => point.code)).toEqual(["P002", "P001", "P004", "P003"])
    expect(normalized.points.map((point) => point.id)).toEqual(legacy.points.map((point) => point.id))
    expect(normalizeDesignPlan(normalized)).toEqual(normalized)
    expect(normalizeDesignPlan(normalizeDesignPlan(normalized))).toEqual(normalized)
    expect(nextPointMapPointCode(legacy.points)).toBe("P005")
    const reordered = normalizeDesignPlan({ ...normalized, points: [...normalized.points].reverse() })
    expect(new Map(reordered.points.map((point) => [point.id, point.code]))).toEqual(
      new Map(normalized.points.map((point) => [point.id, point.code]))
    )
    expect(legacy).toEqual(before)
  })

  it("assigns distinct automatic codes when legacy manual or quote commands append points", () => {
    const template = draft().points[0]
    const legacy = {
      ...emptyPointMapPlan("project"),
      points: [
        { ...template, id: "legacy-without-code", code: undefined },
        { ...template, id: "explicit-one", code: "P001" }
      ]
    }
    const manual = addPointToPlan(
      legacy,
      { room: "玄关", iconId: "switch-1", position: { x: 5, y: 10 } },
      { createId: () => "manual-new" }
    )
    expect(manual.plan.points.map((point) => point.code)).toEqual(["P002", "P001", "P003"])
    const quoted = queueProductPoints(legacy, {
      projectId: "project",
      room: "客厅",
      quantity: 2,
      product: {
        id: "switch-product",
        deviceTypeId: "wall-switch",
        specs: { button_count: 3 },
        name: "智能开关",
        category: "开关",
        spec: "零火",
        unit: "个",
        image: "",
        cost: 10,
        price: 20
      }
    })
    expect(quoted.plan.points.map((point) => point.code)).toEqual(["P002", "P001", "P003", "P004"])
    expect(new Set(quoted.plan.points.map((point) => point.code)).size).toBe(4)
    expect(normalizeDesignPlan(quoted.plan).points.map((point) => point.code)).toEqual([
      "P002",
      "P001",
      "P003",
      "P004"
    ])
    expect(legacy.points[0].code).toBeUndefined()
  })

  it("migrates legacy plans without changing coordinates or domain metadata", () => {
    const base = {
      ...emptyPointMapPlan("project"),
      floorplanName: "legacy.png",
      floorplanDataUrl: png,
      points: [{ ...draft().points[0], floorId: undefined, confidence: "low" as const }]
    }
    const before = structuredClone(base)
    const migrated = normalizeDesignPlan(base)
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.floors).toHaveLength(1)
    expect(migrated.points[0]).toMatchObject({ ...before.points[0], floorId: "floor-default" })
    expect(activePointMapFloor(migrated)).toMatchObject({ id: "floor-default", floorplanDataUrl: png })
    expect(base).toEqual(before)
  })

  it("mirrors only the active floor without losing other floors", () => {
    const current = plan()
    const switched = normalizeDesignPlan({ ...current, activeFloorId: "basement" })
    expect(switched.floorplanDataUrl).toBe(png)
    expect(switched.floorplanName).toBe("synthetic.png")
    expect(switched.floors).toEqual(current.floors)
    expect(switched.points).toEqual(current.points)
  })

  it("keeps new metadata through existing local storage commands", () => {
    const values = new Map<string, string>()
    const storage: PointMapStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      }
    }
    const current = plan()
    writePointMapPlan(current, storage)
    expect(values.has(pointMapStorageKey("project"))).toBe(true)
    expect(readPointMapPlan("project", storage)).toEqual(current)
  })

  it("places two floors once, demotes suggestions and preserves all micro-adjustments on reimport", () => {
    const current = plan()
    expect(current.floors?.map((floor) => floor.id)).toEqual(["ground", "basement"])
    expect(current.points[0].status).toBe("changed")
    expect(current.points[1].status).toBe("planned")
    expect(current.scenes?.[0].status).toBe("proposed")
    current.points[0] = {
      ...current.points[0],
      x: 17.765,
      room: "一楼 / 玄关",
      name: "用户命名",
      productId: "verified-product",
      controlTargets: ["用户确认灯组"],
      status: "confirmed"
    }
    current.scenes![0] = {
      ...current.scenes![0],
      trigger: "面板长按",
      description: "用户确认的动作",
      status: "confirmed"
    }
    current.floors![0].name = "客户确认的一层"
    current.floors![0].floorplanDataUrl = png
    const before = structuredClone(current)
    const result = importPointMapDraft(current, draft())
    expect(result).toMatchObject({ added: 0, skipped: 2 })
    expect(result.plan.points).toEqual(before.points)
    expect(result.plan.scenes).toEqual(before.scenes)
    expect(result.plan.floors).toEqual(before.floors)
    expect(result.plan.updatedAt).toBe(before.updatedAt)
    expect(current).toEqual(before)
  })

  it("preserves edits and stable IDs in JSON export and strict parse roundtrip", () => {
    const current = plan()
    current.points[0] = { ...current.points[0], x: 17.765, controlTargets: ["确认灯组"], status: "confirmed" }
    current.scenes![0].status = "confirmed"
    const exported = exportPointMapDraft(current)
    const parsed = parsePointMapDraft(JSON.stringify(exported))
    expect(parsed).toEqual(exported)
    expect(parsed.points).toEqual(current.points)
    expect(parsed.scenes).toEqual(current.scenes)
    // A new import is still a proposal; confirmation is never granted by a file.
    const imported = importPointMapDraft(emptyPointMapPlan("other-project"), parsed)
    expect(imported.plan.points[0]).toMatchObject({
      id: "ground-K01",
      x: 17.765,
      controlTargets: ["确认灯组"],
      status: "changed"
    })
    expect(imported.plan.scenes![0].status).toBe("proposed")
    parsed.points[0].controlTargets!.push("external change")
    expect(current.points[0].controlTargets).toEqual(["确认灯组"])
  })

  it("assigns manual points to the active floor and invalidates affected scene confirmations on deletion", () => {
    const current = { ...plan(), activeFloorId: "basement" }
    const added = addPointToPlan(
      current,
      { iconId: "switch-1", room: "影音室", position: { x: 10, y: 20 } },
      { createId: () => "new-point" }
    )
    expect(added.point).toMatchObject({ floorId: "basement", source: "manual" })
    added.plan.scenes![0].status = "confirmed"
    const removed = removePointFromPlan(added.plan, "ground-K01")
    expect(removed.scenes![0]).toMatchObject({ pointIds: ["basement-K01"], status: "proposed" })
    const moved = movePointInPlan(
      { ...current, points: [{ ...current.points[1], status: "confirmed" }] },
      "basement-K01",
      { x: 10, y: 15 }
    )
    expect(moved.points[0].status).toBe("changed")
  })
})

describe("strict draft validation", () => {
  it.each(["page", "size", "image"])(
    "rejects a reused floor ID whose %s describes another drawing",
    (kind) => {
      const current = plan()
      const before = structuredClone(current)
      const incoming = draft()
      incoming.points.push({ ...incoming.points[1], id: "additional-panel" })
      if (kind === "page") incoming.floors[1].sourcePage = 27
      if (kind === "size") incoming.floors[1].imageWidth = 2000
      if (kind === "image") incoming.floors[1].floorplanDataUrl = png.replace("AAAADUl", "AAAADVl")
      expect(() => importPointMapDraft(current, incoming)).toThrow("底图不一致")
      expect(current).toEqual(before)
    }
  )

  it.each(["\u202e", "\u2066", "\u200b"])("rejects invisible identifier/code characters", (character) => {
    const input = draft()
    input.points[0].id += character
    expect(() => parsePointMapDraft(input)).toThrow("有效 ID")
    input.points[0].id = "ground-K01"
    input.points[0].code += character
    expect(() => parsePointMapDraft(input)).toThrow("方向控制")
  })
  it.each([
    [
      "non-finite coordinate",
      (input: PointMapDraft) => {
        input.points[0].x = Number.NaN
      }
    ],
    [
      "infinite coordinate",
      (input: PointMapDraft) => {
        input.points[0].y = Infinity
      }
    ],
    [
      "negative coordinate",
      (input: PointMapDraft) => {
        input.points[0].x = -1
      }
    ],
    [
      "coordinate beyond image",
      (input: PointMapDraft) => {
        input.points[0].y = 101
      }
    ],
    [
      "duplicate point",
      (input: PointMapDraft) => {
        input.points.push({ ...input.points[0] })
      }
    ],
    [
      "duplicate floor",
      (input: PointMapDraft) => {
        input.floors.push({ ...input.floors[0] })
      }
    ],
    [
      "duplicate scene",
      (input: PointMapDraft) => {
        input.scenes.push({ ...input.scenes[0] })
      }
    ],
    [
      "dangling floor",
      (input: PointMapDraft) => {
        input.points[0].floorId = "missing"
      }
    ],
    [
      "dangling scene reference",
      (input: PointMapDraft) => {
        input.scenes[0].pointIds.push("missing")
      }
    ],
    [
      "duplicate scene reference",
      (input: PointMapDraft) => {
        input.scenes[0].pointIds.push(input.scenes[0].pointIds[0])
      }
    ],
    [
      "unsupported icon",
      (input: PointMapDraft) => {
        input.points[0].iconId = "unsupported"
      }
    ],
    [
      "unsupported SVG image",
      (input: PointMapDraft) => {
        input.floors[0].floorplanDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
      }
    ],
    [
      "remote image",
      (input: PointMapDraft) => {
        input.floors[0].floorplanDataUrl = "https://example.test/customer.png"
      }
    ],
    [
      "image with mismatched bytes",
      (input: PointMapDraft) => {
        input.floors[0].floorplanDataUrl = "data:image/png;base64,PHN2Zz48L3N2Zz4="
      }
    ],
    [
      "image dimensions",
      (input: PointMapDraft) => {
        input.floors[0].imageWidth = 100
      }
    ],
    [
      "fractional source page",
      (input: PointMapDraft) => {
        input.floors[0].sourcePage = 13.5
      }
    ]
  ])("rejects %s without mutating the existing plan", (_name, mutate) => {
    const current = plan()
    const before = structuredClone(current)
    const input = draft()
    mutate(input)
    expect(() => importPointMapDraft(current, input)).toThrow()
    expect(current).toEqual(before)
  })

  it("rejects numeric strings, missing required fields and unrecognized field names", () => {
    const input = structuredClone(draft()) as unknown as { points: Array<Record<string, unknown>> }
    input.points[0].x = "12"
    expect(() => parsePointMapDraft(input)).toThrow("有限数字")
    input.points[0].x = 12
    delete input.points[0].floorId
    expect(() => parsePointMapDraft(input)).toThrow("floorId")
    input.points[0].floorId = "ground"
    input.points[0].contolTargets = []
    expect(() => parsePointMapDraft(input)).toThrow("不支持的字段")
    expect(() => parsePointMapDraft("not json")).toThrow("JSON")
    expect(() => parsePointMapDraft({ ...draft(), coordinateSystem: "canvas-percent" })).toThrow("原图百分比")
  })

  it("validates ownership and scene references on server saves while migrating valid legacy plans", () => {
    const current = plan()
    expect(validateDesignPlan(current, "project")).toEqual(current)
    expect(() => validateDesignPlan(current, "another-project")).toThrow("当前项目")
    expect(() => validateDesignPlan({ ...current, activeFloorId: "missing" })).toThrow("activeFloorId")
    expect(() =>
      validateDesignPlan({ ...current, scenes: [{ ...current.scenes![0], pointIds: ["missing"] }] })
    ).toThrow("不存在的点位")
    expect(() =>
      validateDesignPlan({ ...current, points: [{ ...current.points[0], floorId: undefined }] })
    ).toThrow("floorId")
    expect(validateDesignPlan(emptyPointMapPlan("legacy")).activeFloorId).toBe("floor-default")
  })
})

describe("loading saved designs over system placeholders", () => {
  function template(type: PropertyType) {
    const floors = defaultSpacesForPropertyType(type).map(({ id, name }) => ({
      id, name, floorplanName: "", floorplanDataUrl: "", imageWidth: 0, imageHeight: 0,
    }))
    return normalizeDesignPlan({ ...emptyPointMapPlan("project-a"), floors, activeFloorId: floors[0].id })
  }
  it("does not treat the default floor or seeded flat/villa names as local edits", () => {
    expect(isPristinePointMapTemplate(emptyPointMapPlan("project-a"))).toBe(true)
    expect(isPristinePointMapTemplate(template("flat"))).toBe(true)
    expect(isPristinePointMapTemplate(template("villa"))).toBe(true)
  })
  it("keeps renamed rooms, custom floor IDs and room lists as local edits", () => {
    for (const patch of [{ name: "客户自定义全屋" }, { id: "custom-floor" }, { rooms: ["茶室"] }]) {
      const plan = template("flat")
      Object.assign(plan.floors![0], patch)
      expect(isPristinePointMapTemplate(plan)).toBe(false)
    }
  })
  it("keeps drawings, dimensions and source-page bindings as local edits", () => {
    for (const patch of [{ floorplanDataUrl: png }, { floorplanName: "待上传.png" }, { imageWidth: 1, imageHeight: 1 }, { sourcePage: 2 }]) {
      const plan = template("flat")
      Object.assign(plan.floors![0], patch)
      expect(isPristinePointMapTemplate(plan)).toBe(false)
    }
  })
  it("keeps pending points and scenes even without an uploaded drawing", () => {
    const plan = template("flat")
    plan.points = [{ ...draft().points[0], floorId: plan.floors![0].id, placed: false }]
    expect(isPristinePointMapTemplate(plan)).toBe(false)
    plan.points = []
    plan.scenes = [{ id: "idea", name: "回家", trigger: "待定", description: "待核", pointIds: [], status: "proposed" }]
    expect(isPristinePointMapTemplate(plan)).toBe(false)
  })
})
