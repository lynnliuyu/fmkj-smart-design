// Native CAD polylines only. No fonts, character substitutes, raster images or common backing rings.
const line = (points, width = 0.105, closed = false) => [
  "pline",
  { vertices: points, width, closed },
];
const rect = (x0, y0, x1, y1, width = 0.12) => [
  "rectang",
  { p1: [x0, y0], p2: [x1, y1], width },
];
const arc = (r, from = 25, to = 155, center = [0, -0.65], width = 0.105) =>
  line(
    Array.from({ length: 17 }, (_, index) => {
      const angle = ((from + ((to - from) * index) / 16) * Math.PI) / 180;
      return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
    }),
    width,
  );
const ring = (r, center = [0, 0], width = 0.105) =>
  arc(r, 0, 360, center, width);
const wifi = () => [
  arc(0.38),
  arc(0.74),
  arc(1.1),
  ring(0.08, [0, -0.65], 0.08),
];
const panel = () => [rect(-1, -1, 1, 1)];
const socket = () => [
  ...panel(),
  line([
    [-0.4, 0.5],
    [-0.4, -0.05],
  ]),
  line([
    [0.4, 0.5],
    [0.4, -0.05],
  ]),
  line([
    [0, -0.35],
    [0, -0.65],
  ]),
];
const switches = (count) => [
  ...panel(),
  ...Array.from({ length: count }, (_, n) => {
    const x0 = -0.78 + (n * 1.56) / count;
    return rect(x0 + 0.04, -0.72, x0 + 1.56 / count - 0.04, 0.72, 0.075);
  }),
];
const blades = () => [
  ring(0.2),
  ...[0, 120, 240].map((degrees) => {
    const a = (degrees * Math.PI) / 180;
    const rotate = ([x, y]) => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ];
    return line(
      [
        [0.1, 0.2],
        [0.1, 0.85],
        [0.6, 0.65],
        [0.45, 0.2],
      ].map(rotate),
      0.11,
      true,
    );
  }),
];
const network = () => [
  rect(-1, -0.8, 1, 0.8),
  line(
    [
      [-0.65, 0.45],
      [0.65, 0.45],
      [0.65, -0.2],
      [0.35, -0.2],
      [0.35, -0.5],
      [-0.35, -0.5],
      [-0.35, -0.2],
      [-0.65, -0.2],
    ],
    0.09,
    true,
  ),
];

const shapes = {
  camera: [
    rect(-0.95, -0.45, 0.4, 0.5),
    line(
      [
        [0.4, 0.25],
        [0.95, 0.65],
        [0.95, -0.65],
        [0.4, -0.25],
      ],
      0.11,
      true,
    ),
    line([
      [-0.35, -0.45],
      [-0.35, -0.9],
      [0.15, -0.9],
    ]),
  ],

  nvr: [
    rect(-1, -0.5, 2, 1, 0.12),
    ring(0.28, [-0.55, 0], 0),
    ring(0.28, [0.25, 0], 0),
    ring(0.09, [0.78, 0], 0),
  ],
  door: [
    rect(-0.85, -1, 0.65, 1),
    line([
      [0.65, -1],
      [-0.4, -0.65],
      [-0.4, 0.65],
      [0.65, 1],
    ]),
    line(
      [
        [0.15, -0.05],
        [0.35, -0.05],
      ],
      0.15,
    ),
  ],
  doorbell: [
    rect(-0.65, -1, 0.65, 1),
    ring(0.2, [0, 0.4]),
    ring(0.3, [0, -0.45]),
  ],
  sensor: wifi(),
  "temperature-sensor": [
    ring(0.35, [0, -0.65]),
    line([
      [-0.2, -0.35],
      [-0.2, 0.8],
      [0.2, 0.8],
      [0.2, -0.35],
    ]),
    line(
      [
        [0, -0.55],
        [0, 0.35],
      ],
      0.14,
    ),
    ...[0, 0.3, 0.6].map((y) =>
      line(
        [
          [0.4, y],
          [0.7, y],
        ],
        0.08,
      ),
    ),
  ],
  "smoke-sensor": [
    ring(0.85),
    ring(0.22),
    ...[-0.4, 0, 0.4].map((x) =>
      line(
        [
          [x, 0.25],
          [x - 0.1, 0.5],
          [x, 0.75],
        ],
        0.075,
      ),
    ),
  ],
  "water-leak-sensor": [
    line(
      [
        [0, 1],
        [-0.65, 0.05],
        [-0.65, -0.5],
        [0, -0.85],
        [0.65, -0.5],
        [0.65, 0.05],
      ],
      0.12,
      true,
    ),
    line(
      [
        [-0.8, -1.1],
        [-0.4, -1],
        [0, -1.1],
        [0.4, -1],
        [0.8, -1.1],
      ],
      0.075,
    ),
  ],
  curtain: [
    line(
      [
        [-1, 0.9],
        [1, 0.9],
      ],
      0.14,
    ),
    ...[-1, 1].map((side) =>
      line(
        [
          [side * 0.9, 0.75],
          [side * 0.3, 0.75],
          [side * 0.55, -0.1],
          [side * 0.3, -0.9],
          [side * 0.9, -0.9],
        ],
        0.1,
        true,
      ),
    ),
    line(
      [
        [0, 0.65],
        [0, -0.65],
      ],
      0.07,
    ),
  ],
  "switch-1": switches(1),
  "switch-2": switches(2),
  "switch-3": switches(3),
  "switch-4": switches(4),
  "dimmer-switch": [
    ...panel(),
    arc(0.58, 10, 170, [0, -0.15]),
    line(
      [
        [0, -0.3],
        [0.42, 0.4],
      ],
      0.13,
    ),
  ],
  socket: socket(),
  "light-strip": [
    line([
      [-1, -0.42],
      [1, -0.42],
    ], 0.16),
    line(
      [
        [-1, 0.42],
        [1, 0.42],
      ],
      0.16,
    ),
    ...[-0.6, 0, 0.6].flatMap((x) => [
      ring(0.13, [x, -0.42], 0.055),
      ring(0.13, [x, 0.42], 0.055),
    ]),
  ],
  "ceiling-light": [
    line(
      [
        [0, 0.85],
        [0, 0.39],
      ],
      0.085,
    ),
    line(
      [
        [0, 0.85],
        [-0.55, 0.62],
        [0, 0.39],
      ],
      0.085,
    ),
    line(
      [
        [0, 0.85],
        [0.55, 0.62],
        [0, 0.39],
      ],
      0.085,
    ),
    ring(0.34, [0, 0.05], 0.105),
  ],
  "smart-bulb": [
    ring(0.5, [0, 0.28], 0.105),
    line(
      [
        [-0.28, -0.28],
        [0.28, -0.28],
      ],
      0.1,
    ),
    line(
      [
        [-0.26, -0.52],
        [0.26, -0.52],
      ],
      0.1,
    ),
    line(
      [
        [-0.2, -0.74],
        [0.2, -0.74],
      ],
      0.1,
    ),
  ],
  "desk-light": [
    line(
      [
        [-0.95, -0.35],
        [0.95, -0.35],
      ],
      0.09,
    ),
    line(
      [
        [-0.6, -0.78],
        [0.6, -0.78],
      ],
      0.14,
    ),
    line(
      [
        [-0.42, -0.52],
        [0.42, -0.52],
      ],
      0.1,
    ),
    line(
      [
        [0, -0.35],
        [0, 0.62],
      ],
      0.09,
    ),
    line(
      [
        [-0.5, 0.72],
        [0, 0.58],
        [0.5, 0.72],
      ],
      0.09,
    ),
    line(
      [
        [-0.34, 0.98],
        [0, 0.84],
        [0.34, 0.98],
      ],
      0.09,
    ),
  ],
  "sky-light": [
    rect(-1, -0.55, 1, -0.05, 0.1),
    line(
      [
        [0, -0.05],
        [0, 0.5],
      ],
      0.09,
    ),
    line(
      [
        [-0.34, 1.02],
        [0, 0.82],
        [0.34, 1.02],
      ],
      0.085,
    ),
    line(
      [
        [-0.72, 0.72],
        [-0.5, 0.62],
      ],
      0.07,
    ),
    line(
      [
        [0.72, 0.72],
        [0.5, 0.62],
      ],
      0.07,
    ),
    line(
      [
        [-0.92, 0.3],
        [-0.68, 0.28],
      ],
      0.07,
    ),
    line(
      [
        [0.92, 0.3],
        [0.68, 0.28],
      ],
      0.07,
    ),
  ],
  "scene-switch": [
    ...panel(),
    rect(-0.78, -0.76, 0.78, 0.76, 0.085),
    rect(-0.6, 0.02, -0.16, 0.46, 0.065),
    rect(-0.1, 0.02, 0.34, 0.46, 0.065),
    rect(-0.6, 0.56, -0.16, 1, 0.065),
    rect(-0.1, 0.56, 0.34, 1, 0.065),
    line(
      [
        [0.42, -0.44],
        [0.42, -0.2],
      ],
      0.07,
    ),
    line(
      [
        [0.28, -0.32],
        [0.56, -0.32],
      ],
      0.07,
    ),
    line(
      [
        [0.36, -0.16],
        [0.48, -0.16],
      ],
      0.07,
    ),
  ],
  "socket-usb": [
    ...panel(),
    rect(-0.67, 0.1, 0.67, 0.5, 0.08),
    rect(-0.67, -0.55, 0.67, -0.15, 0.08),
  ],
  "floor-socket": [
    ...socket(),
    line(
      [
        [-1.2, -0.95],
        [1.2, -0.95],
      ],
      0.15,
    ),
    line(
      [
        [-1.2, -1.2],
        [1.2, -1.2],
      ],
      0.08,
    ),
  ],
  "ac-wall": [
    rect(-1.1, -0.55, 1.1, 0.6),
    line(
      [
        [-0.9, -0.1],
        [0.9, -0.1],
      ],
      0.075,
    ),
    ...[-0.6, 0, 0.6].map((x) =>
      line(
        [
          [x, -0.75],
          [x - 0.15, -1.05],
        ],
        0.09,
      ),
    ),
  ],
  "vrf-controller": [
    ...panel(),
    rect(-0.68, -0.05, 0.68, 0.65, 0.08),
    ring(0.15, [-0.4, -0.55]),
    ring(0.15, [0.4, -0.55]),
  ],
  "exhaust-fan": [...panel(), ...blades()],
  "water-heater": [
    rect(-0.7, -1, 0.7, 1),
    ring(0.18, [0, 0.5]),
    line([
      [-0.35, -1],
      [-0.35, -1.25],
    ]),
    line([
      [0.35, -1],
      [0.35, -1.25],
    ]),
  ],
  gateway: [
    rect(-0.85, -0.7, 0.85, 0.7),
    line([
      [-0.4, 0.7],
      [-0.7, 1.1],
    ]),
    line([
      [0.4, 0.7],
      [0.7, 1.1],
    ]),
    ...[-0.4, 0, 0.4].map((x) => ring(0.06, [x, -0.35], 0.07)),
  ],
  "panel-small": [
    rect(-0.7, -1, 0.7, 1),
    rect(-0.5, -0.55, 0.5, 0.75, 0.07),
    ring(0.09, [0, -0.8], 0.075),
  ],
  "panel-large": [
    rect(-1.15, -0.8, 1.15, 0.8),
    rect(-0.92, -0.58, 0.92, 0.58, 0.07),
    ring(0.07, [1.02, 0], 0.07),
  ],
  speaker: [
    rect(-0.65, -1, 0.65, 1),
    ring(0.43, [0, -0.35]),
    ring(0.18, [0, 0.6]),
    ring(0.12, [0, -0.35], 0.075),
  ],
  ap: [
    ...wifi(),
    line(
      [
        [-0.85, -0.95],
        [0.85, -0.95],
      ],
      0.12,
    ),
  ],
  "network-controller": [
    rect(-1.1, -0.75, 1.1, 0.75),
    rect(-0.78, -0.4, -0.1, 0.4, 0.09),
    ...[-0.62, -0.26].map((y) =>
      line(
        [
          [0.2, y],
          [0.8, y],
        ],
        0.09,
      ),
    ),
    line(
      [
        [0.18, 0.23],
        [0.46, 0.5],
        [0.8, 0.23],
      ],
      0.09,
    ),
    line(
      [
        [0.48, 0.2],
        [0.48, -0.02],
      ],
      0.09,
    ),
  ],
  "poe-switch": [
    rect(-1.15, -0.65, 1.15, 0.65),
    ...[-0.82, -0.28, 0.26].map((x) => rect(x, -0.35, x + 0.36, 0.04, 0.075)),
    line(
      [
        [-0.83, 0.35],
        [0.15, 0.35],
      ],
      0.09,
    ),
    line(
      [
        [0.69, 0.42],
        [0.47, 0.04],
        [0.82, 0.04],
        [0.6, -0.4],
      ],
      0.09,
    ),
  ],
  "mesh-node": [
    line(
      [
        [0, 1],
        [0.87, 0.5],
        [0.87, -0.5],
        [0, -1],
        [-0.87, -0.5],
        [-0.87, 0.5],
      ],
      0.12,
      true,
    ),
    ring(0.3),
    ...[
      [0, 1],
      [0.87, -0.5],
      [-0.87, -0.5],
    ].map((end) => line([[0, 0], end], 0.075)),
  ],
  "data-point": network(),
  downlight: [
    ring(0.8),
    ring(0.35),
    line(
      [
        [-0.55, -0.95],
        [-0.75, -1.2],
      ],
      0.075,
    ),
    line(
      [
        [0.55, -0.95],
        [0.75, -1.2],
      ],
      0.075,
    ),
  ],
  spotlight: [
    line(
      [
        [-0.7, 0.8],
        [0.4, 0.8],
        [0.75, -0.2],
        [-0.35, -0.6],
      ],
      0.12,
      true,
    ),
    line(
      [
        [-0.15, -0.7],
        [-0.65, -1.2],
      ],
      0.08,
    ),
    line(
      [
        [0.55, -0.45],
        [0.65, -1.1],
      ],
      0.08,
    ),
  ],
  "track-light": [
    line(
      [
        [-1.1, 0.8],
        [1.1, 0.8],
      ],
      0.14,
    ),
    ...[-0.65, 0.65].flatMap((x) => [
      line([
        [x, 0.8],
        [x, 0.25],
      ]),
      rect(x - 0.28, -0.6, x + 0.28, 0.25, 0.09),
    ]),
  ],
  "pendant-light": [
    line([
      [0, 1.2],
      [0, 0.3],
    ]),
    line(
      [
        [-0.9, -0.65],
        [-0.45, 0.3],
        [0.45, 0.3],
        [0.9, -0.65],
      ],
      0.12,
      true,
    ),
    line(
      [
        [-0.45, -0.95],
        [0.45, -0.95],
      ],
      0.075,
    ),
  ],
  "wall-light": [
    line(
      [
        [-0.95, -0.85],
        [-0.95, 0.85],
      ],
      0.15,
    ),
    line([
      [-0.95, 0],
      [-0.25, 0],
    ]),
    line(
      [
        [-0.25, -0.7],
        [0.7, -0.4],
        [0.7, 0.4],
        [-0.25, 0.7],
      ],
      0.12,
      true,
    ),
  ],
  "tv-point": [
    rect(-1.1, -0.65, 1.1, 0.75),
    line([
      [0, -0.65],
      [0, -1],
      [-0.55, -1],
      [0.55, -1],
    ]),
  ],
  "distribution-board": [
    ...panel(),
    line(
      [
        [-0.2, 0.65],
        [-0.55, 0],
        [0.15, 0],
        [-0.15, -0.65],
        [0.6, 0.2],
        [0, 0.2],
      ],
      0.09,
    ),
  ],
  "drying-rack": [
    line(
      [
        [-1, 0.8],
        [1, 0.8],
      ],
      0.14,
    ),
    ...[-0.75, 0.75].map((x) =>
      line([
        [x, 0.8],
        [x, -0.8],
      ]),
    ),
    ...[-0.6, 0, 0.6].map((y) =>
      line(
        [
          [-1, y],
          [1, y],
        ],
        0.09,
      ),
    ),
  ],
};
const colors = {
  camera: "190,18,60",
  nvr: "190,18,60",
  door: "37,99,235",
  doorbell: "37,99,235",
  sensor: "180,83,9",
  "temperature-sensor": "180,83,9",
  "smoke-sensor": "180,83,9",
  "water-leak-sensor": "2,132,199",
  curtain: "109,40,217",
  "switch-1": "15,118,110",
  "switch-2": "15,118,110",
  "switch-3": "15,118,110",
  "switch-4": "15,118,110",
  "dimmer-switch": "15,118,110",
  "scene-switch": "15,118,110",
  socket: "180,83,9",
  "socket-usb": "180,83,9",
  "floor-socket": "180,83,9",
  "ac-wall": "8,145,178",
  "vrf-controller": "8,145,178",
  "exhaust-fan": "8,145,178",
  "water-heater": "8,145,178",
  gateway: "21,128,61",
  "panel-small": "2,132,199",
  "panel-large": "79,70,229",
  speaker: "37,99,235",
  ap: "29,78,216",
  "network-controller": "29,78,216",
  "poe-switch": "29,78,216",
  "mesh-node": "29,78,216",
  "data-point": "29,78,216",
  downlight: "161,98,7",
  spotlight: "161,98,7",
  "track-light": "161,98,7",
  "pendant-light": "161,98,7",
  "light-strip": "161,98,7",
  "ceiling-light": "161,98,7",
  "smart-bulb": "161,98,7",
  "desk-light": "161,98,7",
  "sky-light": "161,98,7",
  "wall-light": "161,98,7",
  "tv-point": "71,85,105",
  "distribution-board": "71,85,105",
  "drying-rack": "8,145,178",
};
export const supportedIconIds = Object.freeze(Object.keys(shapes));
export function symbolFor(iconId) {
  const canonical = iconId === "presence" ? "sensor" : iconId;
  const commands = shapes[canonical];
  if (!commands)
    throw new Error(`CAD 原生图标暂不支持: ${iconId}；未使用字符标题替代`);
  return {
    name: `FMKJ_DEVICE_V1_${canonical.replaceAll("-", "_").toUpperCase()}`,
    commands,
    color: colors[canonical] ?? "37,99,235",
    colorHex: `#${(colors[canonical] ?? "37,99,235")
      .split(",")
      .map((value) => Number(value).toString(16).padStart(2, "0"))
      .join("")}`,
  };
}

// This serializer and the CAD bridge consume the same command geometry. Keep the
// CAD Y-up coordinates intact; the SVG group alone flips the drawing for screens.
export function renderPointDeviceSvg(iconId) {
  const symbol = symbolFor(iconId);
  const number = (value) => String(Number(value.toFixed(6)));
  const elements = symbol.commands.map(([command, params]) => {
    if (command === "rectang") {
      const [x0, y0] = params.p1;
      const [x1, y1] = params.p2;
      return `<rect x="${number(Math.min(x0, x1))}" y="${number(Math.min(y0, y1))}" width="${number(Math.abs(x1 - x0))}" height="${number(Math.abs(y1 - y0))}" stroke-width="${number(params.width)}"/>`;
    }
    if (command === "pline") {
      const points = params.vertices
        .map(([x, y]) => `${number(x)},${number(y)}`)
        .join(" ");
      const element = params.closed ? "polygon" : "polyline";
      return `<${element} points="${points}" stroke-width="${number(params.width)}"/>`;
    }
    throw new Error(`设备图形含不支持的 SVG 命令: ${command}`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="-1.4 -1.4 2.8 2.8"><g transform="scale(1,-1)" fill="none" stroke="${symbol.colorHex}" stroke-linecap="round" stroke-linejoin="round">${elements.join("")}</g></svg>\n`;
}
