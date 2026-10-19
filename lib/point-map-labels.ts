import type { PointMapNode } from "./point-map-plan"

/**
 * Customer-facing point-map labels intentionally describe the device class,
 * while the workbench and quote keep their stable point codes.
 */
const markerLabels: Record<string, string> = {
  "switch-1": "单开",
  "switch-2": "双开",
  "switch-3": "三开",
  "switch-4": "四开",
  "dimmer-switch": "调光",
  camera: "监控",
  doorbell: "门铃",
  ap: "AP",
  "network-controller": "AC",
  "poe-switch": "PoE交换机",
  "mesh-node": "Mesh",
  "data-point": "网口",
  "panel-small": "四寸屏",
  "panel-large": "中控大屏",
  gateway: "中枢网关",
  speaker: "音箱",
  curtain: "窗帘",
  door: "门锁",
  sensor: "传感器",
  "temperature-sensor": "传感器",
  "smoke-sensor": "传感器",
  "water-leak-sensor": "传感器",
  socket: "插座",
  "socket-usb": "USB插座",
  "floor-socket": "地插",
  "ac-wall": "AC",
  "vrf-controller": "AC",
  "exhaust-fan": "排风",
  "water-heater": "热水器",
  downlight: "筒灯",
  spotlight: "射灯",
  "track-light": "轨道灯",
  "pendant-light": "吊灯",
  "wall-light": "壁灯",
}

export function pointMapMarkerLabel(point: Pick<PointMapNode, "iconId" | "name">): string {
  return markerLabels[point.iconId] ?? (point.name.trim() || "点位")
}
