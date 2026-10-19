import { symbolFor } from "./point-device-symbols.mjs";
import {
  STANDARD_PRODUCT_CATEGORIES,
  type StandardProductCategory,
} from "./product-categories";

export type PointIconDefinition = {
  id: string;
  category: StandardProductCategory;
  code: string;
  name: string;
  color: string;
  icon: string;
  keywords: string[];
};

export type PointIconGroup = {
  category: StandardProductCategory;
  icons: PointIconDefinition[];
};

// Published v1 drawings retain these immutable assets when future symbols change.
const iconBasePath = "/assets/point-icons/v1";

export const pointIconDefinitions: readonly PointIconDefinition[] = [
  icon("camera", "监控", "V", "摄像头", ["摄像", "监控", "camera", "ipc"]),
  icon("nvr", "监控", "NV", "硬盘录像机", ["nvr", "录像", "存储主机", "dvr"]),
  icon("door", "门锁", "D", "门锁/门磁", [
    "门锁",
    "门磁",
    "门禁",
    "door",
    "lock",
  ]),
  icon("doorbell", "门锁", "B", "门铃", ["门铃", "doorbell"]),
  icon("sensor", "传感器", "P", "人体/存在传感器", [
    "人体",
    "存在",
    "传感",
    "sensor",
    "pir",
  ]),
  icon("temperature-sensor", "传感器", "T", "温湿度传感器", [
    "温湿度",
    "温度",
    "湿度",
    "传感",
  ]),
  icon("smoke-sensor", "传感器", "S", "烟雾传感器", [
    "烟雾",
    "烟感",
    "传感",
    "smoke",
  ]),
  icon("water-leak-sensor", "传感器", "WLS", "水浸传感器", [
    "水浸",
    "漏水",
    "传感",
    "water leak",
  ]),
  icon("curtain", "窗帘", "C", "窗帘电机", ["窗帘", "卷帘", "电机", "curtain"]),
  icon("switch-1", "开关", "K1", "单开智能开关", [
    "单开",
    "单键",
    "开关",
    "灯光",
    "回路",
    "switch",
  ]),
  icon("switch-2", "开关", "K2", "双开智能开关", [
    "双开",
    "双键",
    "开关",
    "灯光",
    "回路",
    "switch",
  ]),
  icon("switch-3", "开关", "K3", "三开智能开关", [
    "三开",
    "三键",
    "开关",
    "灯光",
    "回路",
    "switch",
  ]),
  icon("switch-4", "开关", "K4", "四开智能开关", [
    "四开",
    "四键",
    "开关",
    "灯光",
    "回路",
    "switch",
  ]),
  icon("dimmer-switch", "开关", "DM", "调光开关", ["调光", "开关", "dimmer"]),
  icon("scene-switch", "开关", "SC", "场景面板", [
    "场景",
    "情景",
    "面板",
    "旋钮",
    "scene",
    "panel",
    "keypad",
  ]),
  icon("socket", "插座", "E", "插座", ["插座", "电源", "socket", "outlet"]),
  icon("socket-usb", "插座", "EU", "USB 插座", ["usb", "USB", "插座"]),
  icon("floor-socket", "插座", "EF", "地插", ["地插", "插座"]),
  icon("ac-wall", "暖通控制", "AC", "壁挂机空调", [
    "空调",
    "暖通",
    "AC",
    "hvac",
  ]),
  icon("vrf-controller", "暖通控制", "VRF", "VRF 控制器", [
    "VRF",
    "多联机",
    "中央空调",
    "温控器",
    "空调控制",
  ]),
  icon("exhaust-fan", "暖通控制", "EX", "排风扇", ["排风", "换气", "风扇"]),
  icon("water-heater", "暖通控制", "WH", "热水器", ["热水器"]),
  icon("gateway", "网关中控", "G", "智能网关", [
    "网关",
    "中控",
    "hub",
    "gateway",
  ]),
  icon("panel-small", "网关中控", "TS", "四寸中控屏", [
    "中控",
    "小屏",
    "小屏中控",
    "四寸",
    "4寸",
    "4英寸",
    "4寸中控",
    "4英寸中控",
    "面板",
    "panel",
  ]),
  icon("panel-large", "网关中控", "TL", "大屏中控", [
    "中控",
    "大屏",
    "妙控",
    "面板",
    "panel",
  ]),
  icon("speaker", "网关中控", "A", "智能音箱", ["音箱", "音响", "speaker"]),
  icon("ap", "全屋wifi", "AP", "路由/AP", [
    "AP",
    "ap",
    "路由",
    "wifi",
    "WiFi",
    "网络",
    "无线",
  ]),
  icon("network-controller", "全屋wifi", "WAC", "无线 AC 控制器", [
    "无线控制器",
    "无线ac",
    "无线 ac",
    "wifi控制器",
    "wireless controller",
    "wlan controller",
    "ac controller",
  ]),
  icon("poe-switch", "全屋wifi", "POE", "PoE 交换机", [
    "交换机",
    "poe switch",
    "network switch",
    "ethernet switch",
  ]),
  icon("mesh-node", "全屋wifi", "MESH", "Mesh 节点", [
    "mesh",
    "Mesh",
    "节点",
    "网络",
    "无线",
  ]),
  icon("data-point", "全屋wifi", "NET", "网口", [
    "网口",
    "网络",
    "网线",
    "data",
  ]),
  icon("downlight", "智能灯具", "DL", "智能筒灯", [
    "智能灯",
    "筒灯",
    "灯光",
    "照明",
    "downlight",
  ]),
  icon("spotlight", "智能灯具", "SP", "智能射灯", [
    "智能灯",
    "射灯",
    "灯光",
    "照明",
    "spotlight",
  ]),
  icon("track-light", "智能灯具", "TR", "磁吸轨道灯", [
    "轨道",
    "磁吸",
    "灯光",
    "照明",
  ]),
  icon("pendant-light", "普通灯具", "PL", "吊灯", ["吊灯", "灯光", "照明"]),
  icon("light-strip", "智能灯具", "LS", "灯带", [
    "灯带",
    "灯条",
    "裸条",
    "线性灯",
    "strip",
  ]),
  icon("ceiling-light", "智能灯具", "CL", "吸顶灯", [
    "吸顶灯",
    "主卧灯",
    "次卧灯",
    "客厅灯",
    "贴顶",
    "ceiling",
  ]),
  icon("smart-bulb", "智能灯具", "SB", "智能灯泡", [
    "灯泡",
    "球泡",
    "E27",
    "bulb",
  ]),
  icon("desk-light", "智能灯具", "DL", "屏幕挂灯", [
    "挂灯",
    "台灯",
    "护眼灯",
    "显示器",
    "补光",
  ]),
  icon("sky-light", "智能灯具", "SK", "青空灯", [
    "青空灯",
    "蓝天灯",
    "晴空",
    "天空灯",
    "自然光",
  ]),
  icon("wall-light", "普通灯具", "WL", "壁灯", ["壁灯", "灯光", "照明"]),
  icon("tv-point", "其他", "TV", "电视点位", ["电视", "TV", "影音"]),
  icon("distribution-board", "其他", "DB", "配电箱", [
    "配电箱",
    "强电箱",
    "电箱",
  ]),
  icon("drying-rack", "其他", "DR", "电动晾衣架", ["晾衣", "晾晒"]),
] as const;

export type PointIconId = (typeof pointIconDefinitions)[number]["id"];

export const pointIconGroups: readonly PointIconGroup[] =
  STANDARD_PRODUCT_CATEGORIES.map((category) => ({
    category,
    icons: pointIconDefinitions.filter((icon) => icon.category === category),
  })).filter((group) => group.icons.length > 0);

export function findPointIconById(id?: string | null) {
  if (!id) return undefined;
  return pointIconDefinitions.find((item) => item.id === id);
}

/** A switch point can be a keyed panel or a touch panel at the same location. */
export function pointIconReplacementGroup(iconId: string): {
  label: string;
  icons: readonly PointIconDefinition[];
} {
  const selected = findPointIconById(iconId);
  if (
    selected?.category === "开关" ||
    selected?.id === "panel-small" ||
    selected?.id === "panel-large"
  ) {
    return {
      label: "开关与控制面板",
      icons: pointIconDefinitions.filter(
        (item) =>
          item.category === "开关" ||
          item.id === "panel-small" ||
          item.id === "panel-large",
      ),
    };
  }
  return {
    label: selected?.category ?? "同类别图标",
    icons: selected
      ? pointIconDefinitions.filter(
          (item) => item.category === selected.category,
        )
      : [],
  };
}

function icon(
  id: string,
  category: StandardProductCategory,
  code: string,
  name: string,
  keywords: string[],
): PointIconDefinition {
  const color = symbolFor(id).colorHex;

  return {
    category,
    code,
    color,
    icon: `${iconBasePath}/${id}.svg`,
    id,
    keywords,
    name,
  };
}
