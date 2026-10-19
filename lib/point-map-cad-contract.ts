/** Shared, executable contract for the browser and the local Node 24 CADCraft bridge.
 * Coordinates in an exchange are image percentages; returned positions are CAD Y-up.
 * Files are data. Neither paths nor commands are accepted in these payloads.
 */
export type CadWindow = [number, number, number, number];

export type PointMapCadBinding = {
  format: "cadcraft";
  version: 1;
  drawingId: string;
  drawingSha256: string;
  window: CadWindow;
};

export type CadExchangePoint = {
  id: string;
  code: string;
  iconId: string;
  x: number;
  y: number;
};
export type CadExchange = {
  format: "fmkj-cadcraft-exchange";
  version: 1;
  exchangeId: string;
  projectId: string;
  floorId: string;
  floorName: string;
  drawing: PointMapCadBinding;
  backgroundSha256: string;
  points: CadExchangePoint[];
};
export type CadReturn = {
  format: "fmkj-cadcraft-return";
  version: 1;
  exchange: CadExchange;
  positions: { id: string; cadX: number; cadY: number }[];
};

export function parseCadBinding(value: unknown): PointMapCadBinding {
  const v = record(
    value,
    ["format", "version", "drawingId", "drawingSha256", "window"],
    "CAD 底图绑定",
  );
  if (v.format !== "cadcraft" || v.version !== 1)
    fail("不支持的 CAD 底图绑定格式");
  if (!Array.isArray(v.window) || v.window.length !== 4)
    fail("CAD window 必须包含四个坐标");
  const window = v.window.map((n) =>
    finite(n, "CAD window", -1e12, 1e12),
  ) as CadWindow;
  if (window[2] - window[0] < 1e-6 || window[3] - window[1] < 1e-6)
    fail("CAD window 范围无效");
  return {
    format: "cadcraft",
    version: 1,
    drawingId: id(v.drawingId, "drawingId"),
    drawingSha256: sha(v.drawingSha256),
    window,
  };
}

export function parseCadExchange(value: unknown): CadExchange {
  const v = record(
    json(value),
    [
      "format",
      "version",
      "exchangeId",
      "projectId",
      "floorId",
      "floorName",
      "drawing",
      "backgroundSha256",
      "points",
    ],
    "CAD 交换文件",
  );
  if (v.format !== "fmkj-cadcraft-exchange" || v.version !== 1)
    fail("不是支持的 CAD 交换文件");
  const points = list(v.points, "CAD 点位").map((item) => {
    const p = record(item, ["id", "code", "iconId", "x", "y"], "CAD 点位");
    return {
      id: id(p.id, "点位 ID"),
      code: label(p.code, "点位编号", 100),
      iconId: id(p.iconId, "图标 ID"),
      x: finite(p.x, "x", 0, 100),
      y: finite(p.y, "y", 0, 100),
    };
  });
  unique(points);
  return {
    format: "fmkj-cadcraft-exchange",
    version: 1,
    exchangeId: id(v.exchangeId, "exchangeId"),
    projectId: id(v.projectId, "projectId"),
    floorId: id(v.floorId, "floorId"),
    floorName: label(v.floorName, "楼层名称", 256),
    drawing: parseCadBinding(v.drawing),
    backgroundSha256: sha(v.backgroundSha256),
    points,
  };
}

export function parseCadReturn(value: unknown): CadReturn {
  const v = record(
    json(value),
    ["format", "version", "exchange", "positions"],
    "CAD 回传文件",
  );
  if (v.format !== "fmkj-cadcraft-return" || v.version !== 1)
    fail("不是支持的 CAD 回传文件");
  const exchange = parseCadExchange(v.exchange);
  const positions = list(v.positions, "CAD 回传点位").map((item) => {
    const p = record(item, ["id", "cadX", "cadY"], "CAD 回传点位");
    return {
      id: id(p.id, "点位 ID"),
      cadX: finite(p.cadX, "cadX", -1e12, 1e12),
      cadY: finite(p.cadY, "cadY", -1e12, 1e12),
    };
  });
  unique(positions);
  const expected = new Set(exchange.points.map((point) => point.id));
  if (
    positions.length !== expected.size ||
    positions.some((point) => !expected.has(point.id))
  )
    fail("CAD 回传点位缺失或含未知 ID；请检查删除、复制或炸开的图块");
  positions.forEach((point) =>
    cadToPercent(exchange.drawing.window, point.cadX, point.cadY),
  );
  return { format: "fmkj-cadcraft-return", version: 1, exchange, positions };
}

export function percentToCad(window: CadWindow, x: number, y: number) {
  return {
    cadX: window[0] + (x / 100) * (window[2] - window[0]),
    cadY: window[3] - (y / 100) * (window[3] - window[1]),
  };
}

export function cadToPercent(window: CadWindow, cadX: number, cadY: number) {
  const x = (100 * (cadX - window[0])) / (window[2] - window[0]);
  const y = (100 * (window[3] - cadY)) / (window[3] - window[1]);
  if (
    ![x, y].every(Number.isFinite) ||
    x < -1e-6 ||
    x > 100.000001 ||
    y < -1e-6 ||
    y > 100.000001
  )
    fail("CAD 点位超出已绑定底图范围，请移回图内后重试");
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fail("CAD 文件不是有效 JSON");
  }
}
function record(
  value: unknown,
  keys: string[],
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${name} 必须是对象`);
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in result))
  )
    fail(`${name} 字段不完整或包含未知字段`);
  return result;
}
function label(value: unknown, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(
      value,
    )
  )
    fail(`${name} 无效`);
  return value;
}
function id(value: unknown, name: string) {
  return label(value, name, 200);
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    fail("CAD SHA-256 校验值无效");
  return value;
}
function finite(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`${name} 数值无效`);
  return value;
}
function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > 10000)
    fail(`${name} 数量必须介于 1–10000`);
  return value;
}
function unique(values: { id: string }[]) {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    fail("CAD 点位 ID 重复；复制的图块不能沿用原点位 ID");
}
function fail(message: string): never {
  throw new Error(message);
}
