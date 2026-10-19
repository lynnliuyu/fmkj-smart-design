import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  parseCadExchange,
  parseCadReturn,
  percentToCad,
} from "../../lib/point-map-cad-contract.ts";
import { CadcraftClient } from "./mcp-client.mjs";
import { symbolFor } from "./symbols.mjs";

export const BASE_LAYER = "FMKJ_BASE";
export const POINT_LAYER = "FMKJ_POINT_MAP";
const BUILD_LAYER = "FMKJ_SYMBOL_BUILD";
const TAGS = [
  "FMKJ_ID",
  "FMKJ_FLOOR",
  "FMKJ_DRAWING",
  "FMKJ_EXCHANGE",
  "FMKJ_ICON",
  "FMKJ_BASESHA",
  "POINT_CODE",
];
const MAX_ENTITIES = 100_000;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function loadExchange(path) {
  return parseCadExchange(await readFile(path, "utf8"));
}

export async function queryAll(client, filter = {}) {
  const entities = [];
  for (let offset = 0; offset < MAX_ENTITIES; offset += 1000) {
    const result = await client.tool("query_entities", {
      ...filter,
      limit: 1000,
      offset,
    });
    if (
      !Array.isArray(result?.entities) ||
      !Number.isSafeInteger(result.count) ||
      result.count > MAX_ENTITIES
    )
      throw new Error("CAD 实体查询不完整或超过安全数量限制");
    entities.push(...result.entities);
    if (entities.length === result.count) return entities;
    if (!result.entities.length || entities.length > result.count)
      throw new Error("CAD 实体分页不完整");
  }
  throw new Error("CAD 实体超过安全数量限制");
}

function canonical(value) {
  if (typeof value === "number") return Number(value.toPrecision(12));
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
/** Handles regenerate on save; compare the actual geometry and display semantics instead. */
export function baseGeometrySignature(entities) {
  const entries = entities
    .map((entity) => {
      const semantic = { ...entity };
      delete semantic.handle;
      return JSON.stringify(canonical(semantic));
    })
    .sort();
  return sha256(JSON.stringify(entries));
}

export function pointAttributes(entity) {
  const attributes = entity?.geometry?.attribs;
  if (!Array.isArray(attributes)) return {};
  const result = {};
  for (const attribute of attributes) {
    if (typeof attribute.tag !== "string") continue;
    if (Object.hasOwn(result, attribute.tag))
      throw new Error("CAD 图块包含重复属性标签");
    result[attribute.tag] = attribute.text?.value;
  }
  return result;
}

export function returnFromEntities(exchangeValue, entities) {
  const exchange = parseCadExchange(exchangeValue);
  const expected = new Map(exchange.points.map((point) => [point.id, point]));
  const positions = [];
  for (const entity of entities) {
    const attrs = pointAttributes(entity);
    const name = entity?.geometry?.block;
    const isPoint =
      entity.layer === POINT_LAYER ||
      String(name).startsWith("FMKJ_DEVICE_") ||
      Object.keys(attrs).some((tag) => tag.startsWith("FMKJ_"));
    if (!isPoint) continue;
    const point = expected.get(attrs.FMKJ_ID);
    if (!point)
      throw new Error("CAD 包含未知点位 ID；新增和复制点位请先在工作台创建");
    const symbol = symbolFor(point.iconId);
    if (name !== symbol.name || entity.layer !== POINT_LAYER)
      throw new Error(`CAD 图块名称或图层改变: ${point.code}`);
    if (
      attrs.FMKJ_FLOOR !== exchange.floorId ||
      attrs.FMKJ_DRAWING !== exchange.drawing.drawingId ||
      attrs.FMKJ_EXCHANGE !== exchange.exchangeId ||
      attrs.FMKJ_ICON !== point.iconId ||
      attrs.FMKJ_BASESHA !== exchange.drawing.drawingSha256 ||
      attrs.POINT_CODE !== point.code
    )
      throw new Error(`CAD 图块来源或身份属性不匹配: ${point.code}`);
    if ((entity.geometry.rows ?? 1) !== 1 || (entity.geometry.cols ?? 1) !== 1)
      throw new Error(`CAD 点位不能使用行列阵列: ${point.code}`);
    const insert = entity.geometry.insert;
    if (!insert || (typeof insert.z === "number" && Math.abs(insert.z) > 1e-6))
      throw new Error(`CAD 点位必须位于二维平面: ${point.code}`);
    positions.push({ id: point.id, cadX: insert.x, cadY: insert.y });
  }
  return parseCadReturn({
    format: "fmkj-cadcraft-return",
    version: 1,
    exchange,
    positions,
  });
}

async function originalBase(client, path, exchange) {
  if (sha256(await readFile(path)) !== exchange.drawing.drawingSha256)
    throw new Error("原净底 DXF 的 SHA-256 与交换文件不一致");
  await client.tool("open", { path });
  await assertLockedBase(client);
  const entities = await queryAll(client, { layer: BASE_LAYER });
  if (!entities.length) throw new Error("原净底 FMKJ_BASE 图层没有几何实体");
  return baseGeometrySignature(entities);
}
async function assertLockedBase(client) {
  const drawing = await client.tool("inspect_drawing");
  const layer = drawing.layers?.find((item) => item.name === BASE_LAYER);
  if (!layer?.locked || !layer.on || layer.frozen)
    throw new Error("FMKJ_BASE 底图层必须保持锁定、显示且未冻结");
}
async function assertBaseUnchanged(client, expectedSignature) {
  await assertLockedBase(client);
  if (
    baseGeometrySignature(await queryAll(client, { layer: BASE_LAYER })) !==
    expectedSignature
  )
    throw new Error(
      "CAD 底图几何已改变，无法安全回传；请恢复原净底 FMKJ_BASE 图层",
    );
}
async function sourcePath(path) {
  const result = await realpath(resolve(path));
  if (!(await lstat(result)).isFile()) throw new Error("输入路径必须是文件");
  return result;
}
async function newOutput(path, extension, sources) {
  if (extname(path).toLowerCase() !== extension)
    throw new Error(`输出文件必须使用 ${extension} 扩展名`);
  await mkdir(dirname(resolve(path)), { recursive: true });
  const result = join(await realpath(dirname(resolve(path))), basename(path));
  if (sources.includes(result)) throw new Error("输出不能覆盖输入文件");
  try {
    await lstat(result);
    throw new Error(`输出已存在，请使用新文件名: ${result}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return result;
}
async function verifiedSources(exchangePath, basePath, drawingPath) {
  const sourcePaths = await Promise.all(
    [exchangePath, basePath, ...(drawingPath ? [drawingPath] : [])].map(
      sourcePath,
    ),
  );
  const exchange = await loadExchange(sourcePaths[0]);
  for (const point of exchange.points) symbolFor(point.iconId);
  return {
    exchange,
    sourcePaths,
    base: sourcePaths[1],
    drawing: sourcePaths[2],
  };
}

export async function exportDrawing({
  exchangePath,
  basePath,
  outPath,
  cli = process.env.CADCRAFT_CLI ?? "cadcraft-cli",
  timeoutMs,
}) {
  const { exchange, sourcePaths, base } = await verifiedSources(
    exchangePath,
    basePath,
  );
  const output = await newOutput(outPath, ".dxf", sourcePaths);
  const temp = await mkdtemp(join(dirname(output), ".fmkj-cad-"));
  const client = new CadcraftClient(cli, { timeoutMs });
  try {
    await client.initialize();
    const signature = await originalBase(client, base, exchange);
    const initial = await client.tool("inspect_drawing");
    if (
      initial.blocks?.some((name) => name.startsWith("FMKJ_DEVICE_")) ||
      (await queryAll(client, { type: "INSERT" })).some((entity) =>
        Object.keys(pointAttributes(entity)).some((tag) =>
          tag.startsWith("FMKJ_"),
        ),
      )
    )
      throw new Error("输入必须是原净底，不能是已加入点位的绘图");
    await client.execute("layer.new", {
      name: BUILD_LAYER,
      color: 7,
      current: true,
    });
    const definitions = new Map(
      exchange.points.map((point) => {
        const symbol = symbolFor(point.iconId);
        return [symbol.name, symbol];
      }),
    );
    for (const symbol of definitions.values()) {
      await client.execute("layer.current", { name: BUILD_LAYER });
      for (const [command, params] of symbol.commands)
        await client.execute(command, params);
      for (const tag of TAGS)
        await client.execute("attdef", {
          tag,
          at: [0, 0],
          height: 0.1,
          invisible: true,
        });
      const handles = (await queryAll(client, { layer: BUILD_LAYER })).map(
        (entity) => entity.handle,
      );
      if (!handles.length) throw new Error("CAD 原生图标未生成");
      await client.execute("properties.set", {
        handles,
        layer: "0",
        color: "ByBlock",
      });
      await client.execute("block", {
        name: symbol.name,
        base: [0, 0],
        handles,
        keep: "delete",
        description:
          "FMKJ native device symbol; stable ID attributes; review in workstation",
      });
    }
    await client.execute("layer.new", {
      name: POINT_LAYER,
      color: "37,99,235",
      lineweight: 0.7,
      current: true,
    });
    // The glyph spans ~2 drawing units. Use 2.4% of the shorter window dimension.
    const window = exchange.drawing.window;
    const scale =
      Math.min(window[2] - window[0], window[3] - window[1]) * 0.012;
    for (const point of exchange.points) {
      const symbol = symbolFor(point.iconId);
      const at = percentToCad(window, point.x, point.y);
      await client.execute("insert", {
        name: symbol.name,
        at: [at.cadX, at.cadY],
        scale,
        attribs: {
          FMKJ_ID: point.id,
          FMKJ_FLOOR: exchange.floorId,
          FMKJ_DRAWING: exchange.drawing.drawingId,
          FMKJ_EXCHANGE: exchange.exchangeId,
          FMKJ_ICON: point.iconId,
          FMKJ_BASESHA: exchange.drawing.drawingSha256,
          POINT_CODE: point.code,
        },
      });
    }
    const inserted = await queryAll(client, { type: "INSERT" });
    const byColor = new Map();
    for (const entity of inserted) {
      const point = exchange.points.find(
        (item) => item.id === pointAttributes(entity).FMKJ_ID,
      );
      if (!point) continue;
      const color = symbolFor(point.iconId).color;
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(entity.handle);
    }
    for (const [color, handles] of byColor)
      await client.execute("properties.set", { handles, color });
    await client.execute("zoom", {
      mode: "window",
      p1: window.slice(0, 2),
      p2: window.slice(2),
    });
    const tempDrawing = join(temp, "drawing.dxf");
    await client.tool("save", { path: tempDrawing });
    await client.tool("open", { path: tempDrawing });
    await assertBaseUnchanged(client, signature);
    const returned = returnFromEntities(
      exchange,
      await queryAll(client, { type: "INSERT" }),
    );
    for (const position of returned.positions) {
      const point = exchange.points.find((item) => item.id === position.id);
      const expected = percentToCad(window, point.x, point.y);
      if (
        Math.abs(expected.cadX - position.cadX) > 1e-5 ||
        Math.abs(expected.cadY - position.cadY) > 1e-5
      )
        throw new Error("CAD 保存后插入坐标发生变化");
    }
    if (sha256(await readFile(base)) !== exchange.drawing.drawingSha256)
      throw new Error("处理期间原净底文件改变");
    await copyFile(tempDrawing, output, constants.COPYFILE_EXCL);
    return {
      output,
      points: exchange.points.length,
      floorId: exchange.floorId,
      baseGeometryVerified: true,
    };
  } finally {
    await client.close();
    await rm(temp, { recursive: true, force: true });
  }
}

export async function readDrawing({
  exchangePath,
  basePath,
  drawingPath,
  outPath,
  cli = process.env.CADCRAFT_CLI ?? "cadcraft-cli",
  timeoutMs,
}) {
  const { exchange, sourcePaths, base, drawing } = await verifiedSources(
    exchangePath,
    basePath,
    drawingPath,
  );
  const output = await newOutput(outPath, ".json", sourcePaths);
  const client = new CadcraftClient(cli, { timeoutMs });
  try {
    await client.initialize();
    const signature = await originalBase(client, base, exchange);
    await client.tool("open", { path: drawing });
    await assertBaseUnchanged(client, signature);
    const insertions = await queryAll(client, { type: "INSERT" });
    const strayPointEntities = (
      await queryAll(client, { layer: POINT_LAYER })
    ).filter((entity) => entity.geometry?.type !== "insert");
    const result = returnFromEntities(exchange, [
      ...insertions,
      ...strayPointEntities,
    ]);
    if (sha256(await readFile(base)) !== exchange.drawing.drawingSha256)
      throw new Error("处理期间原净底文件改变");
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
    });
    return {
      output,
      points: result.positions.length,
      floorId: exchange.floorId,
      baseGeometryVerified: true,
    };
  } finally {
    await client.close();
  }
}
