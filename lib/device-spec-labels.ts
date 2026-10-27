/**
 * 参数取值的中文显示。
 *
 * 库里存的是英文记号（neutral / ac-mains / full-spectrum…），界面上必须显示中文。
 * 以前这张映射在三个地方各写了一份，而且译名不一致（同一个 low-voltage 有「低压」和「弱电」、
 * ac-mains 有「市电」和「交流市电」）——客户在报价单和技术页上看到两套说法。
 * 统一到这里，新增枚举值时也只改一处。
 */
export const DEVICE_SPEC_VALUE_LABELS: Record<string, string> = {
  // 接线 / 供电
  neutral: "零火",
  "no-neutral": "单火",
  "dry-contact": "干接点",
  "low-voltage": "低压",
  "ac-mains": "市电",
  dc: "直流",
  poe: "PoE",
  battery: "电池",
  usb: "USB",
  passive: "无源",
  // 使用环境
  indoor: "室内",
  outdoor: "室外",
  "indoor-outdoor": "室内外通用",
  // 联网
  ethernet: "有线网络",
  wifi: "Wi-Fi",
  "ethernet-wifi": "有线 / Wi-Fi",
  cellular: "蜂窝网络",
  analog: "模拟信号",
  // 安装方式
  wall: "壁挂",
  ceiling: "吸顶",
  floor: "落地",
  embedded: "嵌入式",
  track: "轨道",
  surface: "明装",
  "86-box": "86 底盒",
  desktop: "桌面",
  portable: "便携",
  panel: "面板",
  rack: "机架",
  // 颜色
  white: "白色",
  gray: "灰色",
  black: "黑色",
  gold: "金色",
  silver: "银色",
  beige: "米色",
  other: "其他",
  // 材质
  pc: "PC",
  pvc: "PVC",
  glass: "玻璃",
  metal: "金属",
  aluminum: "铝",
  pmma: "亚克力",
  fabric: "布艺",
  wood: "木质",
  // 调光方式
  none: "不可调",
  stepless: "无极调光",
  segmented: "分段调光",
  triac: "可控硅",
  "0-10v": "0-10V",
  dali: "DALI",
  // 驱动要求
  "built-in": "内置驱动",
  external: "外置驱动",
  "required-separately": "需另配驱动",
  // 光谱类型
  "single-cct": "单色温",
  "dual-cct": "双色温",
  "full-spectrum": "全光谱",
  rgb: "RGB",
  "rgb-cct": "RGB + 色温",
  // 接线芯数
  "2-wire": "2 芯",
  "3-wire": "3 芯",
  "4-wire": "4 芯",
  "5-wire": "5 芯",
}

/** 把库里的取值翻成中文；没配映射的原样显示（例如自由文本型号）。 */
export function specValueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否"
  const key = String(value ?? "")
  return DEVICE_SPEC_VALUE_LABELS[key] ?? key
}
