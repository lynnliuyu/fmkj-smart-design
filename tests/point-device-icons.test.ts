import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pointIconDefinitions,
  pointIconReplacementGroup,
} from "../lib/point-icons";
import {
  renderPointDeviceSvg,
  supportedIconIds,
  symbolFor,
} from "../lib/point-device-symbols.mjs";
import { mapProductToPointIcon } from "../lib/point-map-plan";

const product = (name: string, category = "其他", spec = "") => ({
  id: "device",
  name,
  category,
  spec,
  price: 0,
  cost: 0,
  image: "",
  unit: "个",
});

describe("shared workstation and CAD device symbols", () => {
  it("covers every legacy and new device with matching generated SVG geometry and colour", () => {
    expect(pointIconDefinitions).toHaveLength(44);
    expect([...supportedIconIds].sort()).toEqual(
      pointIconDefinitions.map(({ id }) => id).sort(),
    );
    for (const icon of pointIconDefinitions) {
      const symbol = symbolFor(icon.id);
      const svg = readFileSync(
        new URL(`../public${icon.icon}`, import.meta.url),
        "utf8",
      );
      expect(icon.icon).toBe(`/assets/point-icons/v1/${icon.id}.svg`);
      expect(svg).toBe(renderPointDeviceSvg(icon.id));
      expect(svg).toContain('viewBox="-1.4 -1.4 2.8 2.8"');
      expect(svg).toContain('transform="scale(1,-1)"');
      expect(svg).toContain(`stroke="${icon.color}"`);
      expect(icon.color).toBe(symbol.colorHex);
      expect(svg).not.toMatch(
        /<(?:text|image|foreignObject|circle)\b|font-family|<script/i,
      );
      expect((svg.match(/<(?:rect|polyline|polygon)\b/g) ?? []).length).toBe(
        symbol.commands.length,
      );
    }
  });

  it("keeps wireless equipment distinct from air conditioning and lighting switches", () => {
    const ids = [
      "network-controller",
      "poe-switch",
      "ap",
      "ac-wall",
      "vrf-controller",
      "switch-1",
    ];
    expect(
      new Set(ids.map((id) => JSON.stringify(symbolFor(id).commands))).size,
    ).toBe(ids.length);
    for (const id of ["network-controller", "poe-switch"]) {
      expect(
        pointIconDefinitions.find((icon) => icon.id === id)?.category,
      ).toBe("全屋wifi");
    }
  });
});

describe("device product identity", () => {
  it.each([
    ["PoE 室外摄像头", "camera", {}, "camera"],
    ["8-port PoE Switch", "network-switch", {}, "poe-switch"],
    ["无线 AC 控制器", "wlan-controller", {}, "network-controller"],
    ["支持空调和窗帘的四寸屏", "touch-control-panel", { screen_size_in: 4 }, "panel-small"],
    ["APP 远程开关", "wall-switch", { button_count: 2 }, "switch-2"],
    ["空调", "hvac-controller", {}, "vrf-controller"],
  ])("maps %s using structured identity", (name, deviceTypeId, specs, expected) => {
    expect(mapProductToPointIcon({ ...product(name, "其他"), deviceTypeId, specs })).toBe(expected);
  });
  it.each(["AP", "APP远程智能开关", "1/2/3/4键开关价格", "PoE 供电模块", "四寸屏支持空调"])("does not guess a product type from %s", (name) => {
    expect(mapProductToPointIcon(product(name, "其他"))).toBe("data-point");
  });
});

describe("point icon replacement choices", () => {
  it.each(["switch-1", "switch-4", "panel-small", "panel-large"])(
    "lets %s change among keyed switches and control panels at the same point",
    (iconId) => {
      const group = pointIconReplacementGroup(iconId);
      expect(group.label).toBe("开关与控制面板");
      expect(group.icons.map((item) => item.id)).toEqual([
        "switch-1",
        "switch-2",
        "switch-3",
        "switch-4",
        "dimmer-switch",
        "scene-switch",
        "panel-small",
        "panel-large",
      ]);
      expect(group.icons.find((item) => item.id === "panel-small")?.name).toBe(
        "四寸中控屏",
      );
    },
  );

  it("keeps other devices within their catalog category", () => {
    const network = pointIconReplacementGroup("ap");
    expect(network.label).toBe("全屋wifi");
    expect(network.icons.map((item) => item.id)).toContain("poe-switch");
    expect(network.icons.every((item) => item.category === "全屋wifi")).toBe(true);
    const gateways = pointIconReplacementGroup("gateway");
    expect(gateways.label).toBe("网关中控");
    expect(gateways.icons.some((item) => item.category === "开关")).toBe(false);
    expect(pointIconReplacementGroup("unknown").icons).toEqual([]);
  });
});
