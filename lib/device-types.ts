import type { StandardProductCategory } from "./product-categories"

/** Unknown values are absent keys. Display labels and product descriptions are not specs. */
export type DeviceSpecs = Record<string, string | number | boolean>

export type DeviceSpecDefinition = {
  key: string
  name: string
  type: "string" | "number" | "boolean"
  required?: boolean
  requiredForPoint?: boolean
  values?: readonly string[]
  min?: number
  max?: number
  integer?: boolean
  unit?: string
  comparison?: "exact" | "minimum" | "maximum"
  requiredWhen?: { key: string; value: string | number | boolean }
}

export type DeviceTypeDefinition = {
  id: string
  name: string
  category: StandardProductCategory
  defaultIconId: string
  allowedIconIds: readonly string[]
  version: 1
  specs: readonly DeviceSpecDefinition[]
}

const number = (key: string, name: string, options: Omit<DeviceSpecDefinition, "key" | "name" | "type"> = {}): DeviceSpecDefinition => ({ key, name, type: "number", min: 0, comparison: "exact", ...options })
const text = (key: string, name: string, options: Omit<DeviceSpecDefinition, "key" | "name" | "type"> = {}): DeviceSpecDefinition => ({ key, name, type: "string", comparison: "exact", ...options })
const bool = (key: string, name: string, options: Omit<DeviceSpecDefinition, "key" | "name" | "type"> = {}): DeviceSpecDefinition => ({ key, name, type: "boolean", comparison: "exact", ...options })

/** 把若干参数标成必填（复制一份，不影响共享定义）。 */
const requireSpecs = (specs: readonly DeviceSpecDefinition[], keys: string[]): DeviceSpecDefinition[] =>
  specs.map((spec) => (keys.includes(spec.key) ? { ...spec, required: true } : spec))

const power = text("power", "供电方式", { required: true, values: ["ac-mains", "dc", "poe", "battery", "usb", "passive"] })
// 安装方式以前是自由文本，库里已经出现 desktop/wall/ceiling/portable/panel/rack 等写法，
// 转成枚举时这些旧值必须保留，否则老产品在选型里会被判「参数无效」。
const installation = text("installation", "安装方式", {
  values: ["wall", "ceiling", "floor", "embedded", "track", "surface", "86-box", "desktop", "portable", "panel", "rack"],
})

// 外观与电气：以前这些只能写进描述或型号里，统一成属性才能筛选、比价、给客户看。
const color = text("color", "颜色", { values: ["white", "gray", "black", "gold", "silver", "beige", "other"] })
const material = text("material", "材质", { values: ["pc", "pvc", "glass", "metal", "aluminum", "pmma", "fabric", "wood", "other"] })
const ratedVoltage = number("rated_voltage_v", "供电电压", { unit: "V", min: 1 })
const environment = text("environment", "使用环境", { required: true, values: ["indoor", "outdoor", "indoor-outdoor"] })
const buttons = number("button_count", "物理按键数", { required: true, integer: true, min: 1, max: 32 })
const relays = number("relay_count", "继电器路数", { required: true, integer: true, max: 64, comparison: "minimum" })
const maxLoad = number("max_load_w", "最大负载", { unit: "W", comparison: "minimum" })
const ports = number("port_count", "端口数", { required: true, integer: true, min: 1, max: 1024, comparison: "minimum" })
const network = text("network", "联网方式", { required: true, values: ["ethernet", "wifi", "ethernet-wifi", "cellular", "analog"] })
const lightSpecs = [
  power,
  installation,
  number("power_w", "功率", { min: 0.01, unit: "W" }),
  number("cutout_mm", "开孔直径", { min: 0.01, unit: "mm" }),
  number("color_temperature_k", "色温", { min: 100, max: 20000, unit: "K" }),
  // 调光方式、驱动要求原来是自由文本（库里出现过把「双色温」写进调光的），统一成枚举。
  text("dimming", "调光方式", { values: ["none", "stepless", "segmented", "triac", "0-10v", "dali"] }),
  text("driver", "驱动要求", { values: ["built-in", "external", "required-separately"] }),
  // 光谱类型：全光谱 / 双色温 / 单色温 / RGB / RGB+CCT，用枚举而不是塞进描述里。
  text("spectrum", "光谱类型", { values: ["single-cct", "dual-cct", "full-spectrum", "rgb", "rgb-cct"] }),
  // 接线芯数：现场最常问的一句「这个是几芯线」。
  text("wire_count", "接线芯数", { values: ["2-wire", "3-wire", "4-wire", "5-wire"] }),
  number("cri", "显色指数", { min: 0, max: 100, integer: true, unit: "Ra" }),
  color,
  material,
  ratedVoltage,
]
const sensorSpecs = [power, installation, number("range_m", "检测范围", { unit: "m", comparison: "minimum" })]
// 传感器：探测技术 + 探测距离是选型与布置的依据，设成必填。
const detection = text("detection", "检测技术", { required: true, values: ["pir", "mmwave", "ultrasonic", "photoelectric", "other"] })
const sensorSpecsFull = requireSpecs([...sensorSpecs, detection], ["range_m"])
const socketSpecs = [power, installation, number("rated_current_a", "额定电流", { required: true, min: 0.01, unit: "A", comparison: "minimum" }), color, material, ratedVoltage]
const pointRequired = (field: DeviceSpecDefinition): DeviceSpecDefinition => ({ ...field, requiredForPoint: true })

/**
 * 用户 2026-10-23 定的规则：**只有「点位规划与自动报价必需的参数」才是必填**，其余一律可选项。
 * 落到代码上就是：必填 ⟺ 标了 requiredForPoint（点位里必须指定的那些）。
 *
 * 这样「填了更清楚、但缺了照样能出方案」的信息（颜色、材质、功率、开孔、显色指数…）
 * 都不会再挡住选型；而墙壁开关的按键数/继电器路数/接线方式这类配型依据仍然是必填。
 */
function applyRequiredRule(specs: readonly DeviceSpecDefinition[]): DeviceSpecDefinition[] {
  return specs.map((spec) => (spec.requiredForPoint ? { ...spec, required: true } : { ...spec, required: false }))
}

function device(id: string, name: string, category: StandardProductCategory, defaultIconId: string, specs: readonly DeviceSpecDefinition[], allowedIconIds: readonly string[] = [defaultIconId]): DeviceTypeDefinition {
  return { id, name, category, defaultIconId, specs: applyRequiredRule(specs), allowedIconIds, version: 1 }
}

/** Stable business roles, intentionally separate from icon IDs and navigation categories. */
export const deviceTypes: readonly DeviceTypeDefinition[] = [
  device("wall-switch", "墙壁开关", "开关", "switch-1", [pointRequired(buttons), pointRequired(relays), text("wiring", "接线方式", { required: true, requiredForPoint: true, values: ["neutral", "no-neutral", "dry-contact", "low-voltage"] }), installation, maxLoad, number("box_depth_mm", "所需底盒深度", { unit: "mm", comparison: "maximum" }), color, material, ratedVoltage], ["switch-1", "switch-2", "switch-3", "switch-4"]),
  device("dimmer-controller", "调光控制器", "开关", "dimmer-switch", [power, text("dimming", "调光方式", { required: true }), maxLoad, installation]),
  device("scene-panel", "场景面板", "开关", "scene-switch", [buttons, power, relays, installation]),
  device("keyed-control-panel", "按键控制面板", "开关", "scene-switch", [buttons, power, relays, installation]),
  device("touch-control-panel", "触控中控屏", "网关中控", "panel-small", [number("screen_size_in", "屏幕尺寸", { required: true, requiredForPoint: true, min: 0.1, max: 120, unit: "英寸" }), pointRequired(power), pointRequired(relays), installation, number("box_depth_mm", "所需底盒深度", { unit: "mm", comparison: "maximum" })], ["panel-small", "panel-large"]),
  device("smart-home-gateway", "智能家居网关", "网关中控", "gateway", [power, installation, number("device_capacity", "接入设备容量", { required: true, integer: true, min: 1, comparison: "minimum" })]),
  device("camera", "摄像头", "监控", "camera", [pointRequired(environment), pointRequired(power), pointRequired(network), installation, number("field_of_view_deg", "视场角", { min: 1, max: 360, unit: "°", comparison: "minimum" }), text("storage", "存储方式")]),
  device("nvr", "硬盘录像机", "监控", "nvr", [pointRequired(power), number("channel_count", "接入路数", { min: 1, max: 128, unit: "路", integer: true, comparison: "minimum", requiredForPoint: true }), pointRequired(installation), bool("poe_switch", "内置 PoE 交换")]),
  device("wireless-ap", "无线 AP", "全屋wifi", "ap", [pointRequired(power), pointRequired(installation), text("wireless_standard", "无线制式", { required: true }), text("controller_compatibility", "兼容 AC/管理系统"), bool("poe_input", "支持 PoE 输入")]),
  device("router", "路由器", "全屋wifi", "ap", [power, ports, installation, text("wireless_standard", "无线制式")]),
  device("wlan-controller", "无线 AC 控制器", "全屋wifi", "network-controller", [power, number("ap_capacity", "管理 AP 数量", { required: true, integer: true, min: 1, comparison: "minimum" }), text("ap_compatibility", "兼容 AP 系列", { required: true }), installation, bool("poe_output", "提供 PoE 输出")]),
  device("network-switch", "网络交换机", "全屋wifi", "poe-switch", [power, ports, bool("poe_output", "提供 PoE 输出", { required: true }), text("poe_standard", "PoE 标准", { requiredWhen: { key: "poe_output", value: true } }), number("poe_budget_w", "PoE 总功率", { unit: "W", comparison: "minimum", requiredWhen: { key: "poe_output", value: true } }), installation]),
  device("mesh-node", "Mesh 节点", "全屋wifi", "mesh-node", [power, text("mesh_compatibility", "兼容 Mesh 系统", { required: true }), installation]),
  device("data-outlet", "网络接口", "全屋wifi", "data-point", [ports, text("interface", "接口规格", { required: true }), installation]),
  device("curtain-motor", "窗帘电机", "窗帘", "curtain", [pointRequired(power), text("track_type", "适配轨道类型", { required: true }), number("rated_load_kg", "额定承重", { unit: "kg", comparison: "minimum" }), installation]),
  device("curtain-track", "窗帘轨道", "窗帘", "curtain", [text("track_type", "轨道类型", { required: true }), text("motor_compatibility", "兼容电机", { required: true }), number("length_m", "轨道长度", { unit: "m", min: 0.01 })]),
  device("curtain-kit", "窗帘轨道电机套装", "窗帘", "curtain", [pointRequired(power), number("motor_count", "电机数量", { required: true, integer: true, min: 1 }), bool("track_included", "包含轨道", { required: true }), text("kit_scope", "套装供货范围", { required: true }), text("track_type", "轨道类型", { required: true }), number("length_m", "轨道长度", { unit: "m", min: 0.01 })]),
  device("door-lock", "门锁", "门锁", "door", [power, text("lock_body", "锁体规格", { required: true }), text("door_type", "适配门型", { required: true }), installation]),
  device("contact-sensor", "门窗磁传感器", "传感器", "door", sensorSpecs),
  device("doorbell", "门铃", "门锁", "doorbell", [power, environment, installation]),
  device("motion-sensor", "人体移动传感器", "传感器", "sensor", sensorSpecsFull),
  device("presence-sensor", "人体存在传感器", "传感器", "sensor", sensorSpecsFull),
  device("temperature-humidity-sensor", "温湿度传感器", "传感器", "temperature-sensor", sensorSpecs),
  device("smoke-sensor", "烟雾传感器", "传感器", "smoke-sensor", sensorSpecs),
  device("water-leak-sensor", "水浸传感器", "传感器", "water-leak-sensor", sensorSpecs),
  device("socket", "插座", "插座", "socket", socketSpecs),
  device("usb-socket", "USB 插座", "插座", "socket-usb", [...socketSpecs, text("usb_interface", "USB 接口规格", { required: true })]),
  device("floor-socket", "地面插座", "插座", "floor-socket", socketSpecs),
  device("track-socket", "轨道插座", "插座", "socket", [...socketSpecs, number("length_m", "轨道长度", { min: 0.01, unit: "m" })]),
  device("air-conditioner", "空调设备", "暖通控制", "ac-wall", [power, text("hvac_compatibility", "空调系统规格", { required: true }), installation]),
  device("hvac-controller", "暖通控制器", "暖通控制", "vrf-controller", [power, text("hvac_compatibility", "兼容暖通系统", { required: true }), installation]),
  device("exhaust-fan", "排风扇", "暖通控制", "exhaust-fan", [power, installation]),
  device("water-heater", "热水器", "暖通控制", "water-heater", [power, installation]),
  device("smart-speaker", "智能音箱", "网关中控", "speaker", [power, installation]),
  device("ceiling-speaker", "吸顶扬声器", "网关中控", "speaker", [power, text("amplifier_compatibility", "兼容功放系统", { required: true }), installation]),
  device("downlight", "筒灯", "智能灯具", "downlight", lightSpecs),
  device("spotlight", "射灯", "智能灯具", "spotlight", lightSpecs),
  device("track-light", "磁吸轨道灯", "智能灯具", "track-light", [...lightSpecs, text("track_compatibility", "轨道规格")]),
  device("pendant-light", "吊灯", "普通灯具", "pendant-light", lightSpecs),
  device("wall-light", "壁灯", "普通灯具", "wall-light", lightSpecs),
  device("lighting-power-supply", "灯具电源", "智能灯具", "gateway", [power, number("output_voltage_v", "输出电压", { required: true, min: 0.01, unit: "V" }), number("output_power_w", "额定输出功率", { required: true, min: 0.01, unit: "W", comparison: "minimum" })]),
  device("panel-light", "平板灯", "智能灯具", "downlight", lightSpecs),
  device("grille-light", "格栅灯", "智能灯具", "spotlight", lightSpecs),
  device("fan-light", "风扇灯", "智能灯具", "pendant-light", lightSpecs),
  device("light-strip", "灯带", "智能灯具", "light-strip", [...lightSpecs, number("strip_length_m", "灯带长度", { min: 0.01, unit: "m" }), number("led_count", "LED 数量", { min: 1, integer: true })]),
  device("ceiling-light", "吸顶灯", "智能灯具", "ceiling-light", [...lightSpecs, number("diameter_mm", "灯具直径", { min: 1, unit: "mm" }), number("applicable_area_m2", "适用面积", { min: 0, unit: "㎡" })]),
  device("smart-bulb", "智能灯泡", "智能灯具", "smart-bulb", [...lightSpecs, text("lamp_base", "灯头规格", { required: true }), text("color_control", "色彩控制")]),
  device("desk-light", "屏幕挂灯", "智能灯具", "desk-light", [...lightSpecs, number("color_temp_min_k", "色温下限", { min: 100, max: 20000, unit: "K" }), number("color_temp_max_k", "色温上限", { min: 100, max: 20000, unit: "K" }), text("mount_type", "安装方式"), text("control", "控制方式")]),
  device("sky-light", "青空灯", "智能灯具", "sky-light", [...lightSpecs, number("luminous_flux_lm", "光通量", { min: 0, unit: "lm" }), text("sky_simulation", "天空模拟方式")]),
  device("tv-outlet", "电视接口", "其他", "tv-point", [text("interface", "接口规格", { required: true }), installation]),
  device("distribution-board", "配电箱", "其他", "distribution-board", [number("module_capacity", "模块位数", { required: true, min: 1, integer: true, comparison: "minimum" }), installation]),
  device("drying-rack", "电动晾衣架", "其他", "drying-rack", [power, installation, number("rated_load_kg", "额定承重", { unit: "kg", comparison: "minimum" })]),
  device("accessory", "安装配件", "其他", "", [text("accessory_compatibility", "适配设备及规格", { required: true })], []),
  device("installation-service", "安装服务", "其他", "", [text("scope", "服务范围", { required: true })], []),
]

export function findDeviceType(id?: string | null): DeviceTypeDefinition | undefined {
  return deviceTypes.find((type) => type.id === id)
}

export function validateDeviceSpecs(typeId: string | null | undefined, value: unknown): { specs: DeviceSpecs; errors: string[] } {
  if (value == null) return { specs: {}, errors: [] }
  if (typeof value !== "object" || Array.isArray(value)) return { specs: {}, errors: ["规格必须为参数对象"] }
  const type = findDeviceType(typeId)
  const specs: DeviceSpecs = {}
  const errors: string[] = []
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) continue
    const definition = type?.specs.find((field) => field.key === key)
    if (!definition) { errors.push(`${key}：${type ? "该设备类型不支持此参数" : "请先选择有效设备类型"}`); continue }
    if (typeof raw !== definition.type) { errors.push(`${definition.name}：应为${definition.type === "number" ? "数值" : definition.type === "boolean" ? "是/否" : "文字"}`); continue }
    if (typeof raw === "number" && (!Number.isFinite(raw) || (definition.integer && !Number.isInteger(raw)) || (definition.min != null && raw < definition.min) || (definition.max != null && raw > definition.max))) {
      errors.push(`${definition.name}：数值超出允许范围或不是有效${definition.integer ? "整数" : "数值"}`); continue
    }
    if (typeof raw === "string") {
      const normalized = raw.trim()
      if (!normalized || normalized.length > 500 || (definition.values && !definition.values.includes(normalized))) { errors.push(`${definition.name}：请填写允许的有效值，未知时留空`); continue }
      specs[key] = normalized
    } else if (typeof raw === "boolean" || typeof raw === "number") specs[key] = raw
  }
  return { specs, errors }
}

export function normalizeDeviceSpecs(typeId: string | null | undefined, value: unknown): DeviceSpecs {
  const result = validateDeviceSpecs(typeId, value)
  if (result.errors.length) throw new Error(result.errors.join("；"))
  return result.specs
}

export function missingRequiredDeviceSpecs(typeId: string | null | undefined, specs: DeviceSpecs): string[] {
  return findDeviceType(typeId)?.specs.filter((field) => (field.required || (field.requiredWhen && specs[field.requiredWhen.key] === field.requiredWhen.value)) && specs[field.key] == null).map((field) => field.name) ?? []
}
