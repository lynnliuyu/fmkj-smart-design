import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pointIconDefinitions } from "../lib/point-icons";
import { parseCadExchange } from "../lib/point-map-cad-contract";
import {
  baseGeometrySignature,
  pointAttributes,
  returnFromEntities,
} from "../scripts/cadcraft/bridge.mjs";
import { CadcraftClient } from "../scripts/cadcraft/mcp-client.mjs";
import { supportedIconIds, symbolFor } from "../scripts/cadcraft/symbols.mjs";

const exchange = parseCadExchange({
  format: "fmkj-cadcraft-exchange",
  version: 1,
  exchangeId: "exchange-one",
  projectId: "project-one",
  floorId: "floor-one",
  floorName: "一楼",
  drawing: {
    format: "cadcraft",
    version: 1,
    drawingId: "drawing-one",
    drawingSha256: "a".repeat(64),
    window: [100, 200, 1100, 2200],
  },
  backgroundSha256: "b".repeat(64),
  points: [{ id: "point-one", code: "K01", iconId: "switch-1", x: 20, y: 30 }],
});
function entity(overrides: Record<string, unknown> = {}) {
  return {
    handle: "A1",
    layer: "FMKJ_POINT_MAP",
    type: "Block Reference",
    geometry: {
      block: symbolFor("switch-1").name,
      insert: { x: 300, y: 1600, z: 0 },
      rows: 1,
      cols: 1,
      attribs: Object.entries({
        FMKJ_ID: "point-one",
        FMKJ_FLOOR: "floor-one",
        FMKJ_DRAWING: "drawing-one",
        FMKJ_EXCHANGE: "exchange-one",
        FMKJ_ICON: "switch-1",
        FMKJ_BASESHA: "a".repeat(64),
        POINT_CODE: "K01",
        ...overrides,
      }).map(([tag, value]) => ({ tag, text: { value } })),
    },
  };
}

describe("native CAD point identity and coordinates", () => {
  it("returns moved insertion coordinates independently of regenerated handles", () => {
    const point = entity();
    point.handle = "FEE1";
    point.geometry.insert.x += 50;
    expect(returnFromEntities(exchange, [point]).positions).toEqual([
      { id: "point-one", cadX: 350, cadY: 1600 },
    ]);
  });
  it("rejects copied IDs, deleted points, unknown IDs and altered source attributes", () => {
    expect(() => returnFromEntities(exchange, [entity(), entity()])).toThrow(
      /重复/,
    );
    expect(() => returnFromEntities(exchange, [])).toThrow();
    expect(() =>
      returnFromEntities(exchange, [entity({ FMKJ_ID: "new-point" })]),
    ).toThrow(/未知/);
    for (const tag of [
      "FMKJ_FLOOR",
      "FMKJ_DRAWING",
      "FMKJ_EXCHANGE",
      "FMKJ_ICON",
      "FMKJ_BASESHA",
      "POINT_CODE",
    ])
      expect(() =>
        returnFromEntities(exchange, [entity({ [tag]: "changed" })]),
      ).toThrow(/不匹配/);
  });
  it("rejects out of window positions, wrong blocks, moved layers and arrayed points", () => {
    const outside = entity();
    outside.geometry.insert.x = 1200;
    expect(() => returnFromEntities(exchange, [outside])).toThrow(/超出/);
    const wrong = entity();
    wrong.geometry.block = symbolFor("camera").name;
    expect(() => returnFromEntities(exchange, [wrong])).toThrow(/名称/);
    const layer = entity();
    layer.layer = "0";
    expect(() => returnFromEntities(exchange, [layer])).toThrow(/图层/);
    const array = entity();
    array.geometry.rows = 2;
    expect(() => returnFromEntities(exchange, [array])).toThrow(/阵列/);
  });
  it("rejects duplicate attribute tags and a nonplanar point", () => {
    const duplicate = entity();
    duplicate.geometry.attribs.push({
      tag: "FMKJ_ID",
      text: { value: "point-one" },
    });
    expect(() => pointAttributes(duplicate)).toThrow(/重复属性/);
    const nonplanar = entity();
    nonplanar.geometry.insert.z = 10;
    expect(() => returnFromEntities(exchange, [nonplanar])).toThrow(/二维/);
  });
});

describe("CAD base geometry preservation", () => {
  it("ignores handle and entity order while detecting an unlocked-and-moved base", () => {
    const one = {
      handle: "A",
      type: "Line",
      layer: "FMKJ_BASE",
      geometry: { a: { x: 100, y: 200 }, b: { x: 300, y: 400 } },
    };
    const two = {
      handle: "B",
      type: "Circle",
      layer: "FMKJ_BASE",
      geometry: { center: { x: 500, y: 600 }, radius: 20 },
    };
    expect(baseGeometrySignature([one, two])).toBe(
      baseGeometrySignature([
        { ...two, handle: "F01" },
        { ...one, handle: "F02" },
      ]),
    );
    expect(baseGeometrySignature([one, two])).not.toBe(
      baseGeometrySignature([
        { ...one, geometry: { ...one.geometry, a: { x: 101, y: 200 } } },
        two,
      ]),
    );
  });
});

describe("native semantic symbols", () => {
  it("covers every workstation icon with native non-text geometry", () => {
    expect(supportedIconIds).toHaveLength(44);
    for (const icon of pointIconDefinitions) {
      const symbol = symbolFor(icon.id);
      expect(symbol.commands.length).toBeGreaterThan(1);
      expect(
        symbol.commands.every(([command]: [string, unknown]) =>
          ["pline", "rectang"].includes(command),
        ),
      ).toBe(true);
    }
    expect(symbolFor("switch-1").commands).not.toEqual(
      symbolFor("switch-4").commands,
    );
    expect(symbolFor("camera").commands).not.toEqual(
      symbolFor("sensor").commands,
    );
    expect(() => symbolFor("unknown-device")).toThrow(/未使用字符/);
  });
});

function fakeChild(
  onRequest: (
    message: { id?: number; method?: string },
    stdout: PassThrough,
  ) => void,
) {
  const process = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: (signal: string): boolean => signal.length === 0,
  });
  process.stdin.on("data", (buffer) =>
    onRequest(JSON.parse(buffer.toString()), process.stdout),
  );
  process.kill = (signal) => {
    process.signalCode = signal;
    process.emit("exit", null, signal);
    return true;
  };
  return process;
}

describe("private MCP stdio transport", () => {
  it("bounds cleanup when a real executable is missing or never answers", async () => {
    const missing = new CadcraftClient("/nonexistent/fmkj-cadcraft-cli", {
      timeoutMs: 500,
    });
    const start = Date.now();
    await expect(missing.initialize()).rejects.toThrow(/无法启动/);
    await missing.close();
    expect(Date.now() - start).toBeLessThan(1000);
    const dir = await mkdtemp(join(tmpdir(), "fmkj-cadcraft-test-"));
    const executable = join(dir, "silent-cli");
    await writeFile(
      executable,
      `#!${process.execPath}\nsetInterval(() => {}, 1000)\n`,
    );
    await chmod(executable, 0o700);
    const silent = new CadcraftClient(executable, { timeoutMs: 30 });
    try {
      await expect(silent.initialize()).rejects.toThrow(/超时/);
      await silent.close();
      expect(silent.process.signalCode).toBe("SIGTERM");
    } finally {
      await silent.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("accepts split JSON-RPC frames and ignores notifications between responses", async () => {
    const child = fakeChild((request, stdout) => {
      if (request.id === undefined) return;
      stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progress: 1 },
        }) + "\n",
      );
      const response =
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: "2024-11-05" },
        }) + "\n";
      stdout.write(response.slice(0, 15));
      stdout.write(response.slice(15));
    });
    const client = new CadcraftClient("unused", {
      spawnProcess: (() => child) as never,
      timeoutMs: 500,
    });
    try {
      await expect(client.initialize()).resolves.toBe(client);
    } finally {
      await client.close();
    }
    expect(child.signalCode).toBe("SIGTERM");
  });
  it("terminates a stalled process and rejects the timed out request", async () => {
    const child = fakeChild(() => undefined);
    const client = new CadcraftClient("unused", {
      spawnProcess: (() => child) as never,
      timeoutMs: 10,
    });
    await expect(client.initialize()).rejects.toThrow(/超时/);
    expect(child.signalCode).toBe("SIGTERM");
    await client.close();
  });
  it("rejects invalid JSON and tool failures", async () => {
    const child = fakeChild((_request, stdout) => stdout.write("bad-data\n"));
    const client = new CadcraftClient("unused", {
      spawnProcess: (() => child) as never,
      timeoutMs: 500,
    });
    await expect(client.initialize()).rejects.toThrow(/非 JSON/);
    await client.close();
    const failed = fakeChild((request, stdout) => {
      if (request.id)
        stdout.write(
          JSON.stringify({
            id: request.id,
            result: {
              isError: true,
              content: [{ type: "text", text: "bad command" }],
            },
          }) + "\n",
        );
    });
    const toolClient = new CadcraftClient("unused", {
      spawnProcess: (() => failed) as never,
      timeoutMs: 500,
    });
    try {
      await expect(toolClient.tool("execute")).rejects.toThrow(/bad command/);
    } finally {
      await toolClient.close();
    }
  });
});
