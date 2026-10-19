#!/usr/bin/env node
import { exportDrawing, readDrawing } from "./cadcraft/bridge.mjs";

const usage = `本地 CADCraft 点位桥接（Node.js 24+，CADCraft CLI 0.5.0）
导出: node scripts/cadcraft-point-map.mjs export --exchange exchange.json --base clean.dxf --out points.dxf [--cli /path/cadcraft-cli]
回传: node scripts/cadcraft-point-map.mjs read --exchange exchange.json --base clean.dxf --drawing edited.dxf --out return.json [--cli /path/cadcraft-cli]
CLI 路径也可使用 CADCRAFT_CLI。输出必须使用新文件名，不覆盖原图。`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "help" || !command) {
    console.log(usage);
    return;
  }
  if (!["export", "read"].includes(command)) throw new Error(usage);
  const allowed = new Set([
    "--exchange",
    "--base",
    "--out",
    "--cli",
    ...(command === "read" ? ["--drawing"] : []),
  ]);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !allowed.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      Object.hasOwn(flags, args[i])
    )
      throw new Error(`无效或重复参数: ${args[i]}`);
    flags[args[i]] = args[i + 1];
  }
  for (const name of [
    "--exchange",
    "--base",
    "--out",
    ...(command === "read" ? ["--drawing"] : []),
  ])
    if (!flags[name]) throw new Error(`缺少参数 ${name}\n${usage}`);
  const options = {
    exchangePath: flags["--exchange"],
    basePath: flags["--base"],
    outPath: flags["--out"],
    drawingPath: flags["--drawing"],
    cli: flags["--cli"],
  };
  console.log(
    JSON.stringify(
      await (command === "export"
        ? exportDrawing(options)
        : readDrawing(options)),
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(`CAD 点位桥接失败: ${error.message}`);
  process.exitCode = 1;
});
