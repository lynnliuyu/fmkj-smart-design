"use client";

import * as React from "react";
import { ArrowRight, Download, RefreshCw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  applyCadReturn,
  createCadExchange,
  previewCadReturn,
  type CadReturnPreview,
} from "@/lib/point-map-cad";
import type { PointMapFloor, PointMapPlan } from "@/lib/point-map-plan";

export type PointMapCadContext = {
  plan: PointMapPlan;
  projectId: string;
  floorId: string | undefined;
  editingDisabled: boolean;
  uploading: boolean;
};

type Preview = { result: CadReturnPreview; plan: PointMapPlan };
type Operation = "exporting" | "reading" | "checking" | "applying" | null;

export function PointMapCadPanel({
  plan,
  floor,
  projectName,
  editingDisabled,
  uploading,
  getCurrentContext,
  onApply,
}: {
  plan: PointMapPlan;
  floor: PointMapFloor | undefined;
  projectName: string;
  editingDisabled: boolean;
  uploading: boolean;
  getCurrentContext: () => PointMapCadContext;
  onApply: (next: PointMapPlan, expected: PointMapPlan) => boolean;
}) {
  const fileInput = React.useRef<HTMLInputElement>(null);
  const requestRef = React.useRef(0);
  const [operation, setOperation] = React.useState<Operation>(null);
  const [source, setSource] = React.useState<{
    name: string;
    text: string;
  } | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const bound = Boolean(floor?.cad);
  const placedCount = plan.points.filter(
    (point) => point.floorId === floor?.id && point.placed,
  ).length;
  const stale = Boolean(preview && preview.plan !== plan);
  const canWrite = bound && !editingDisabled && !uploading;
  const busy = operation !== null;
  React.useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  function unchangedContext(
    start: PointMapCadContext,
    request: number,
    requireWrite: boolean,
  ) {
    const current = getCurrentContext();
    return (
      request === requestRef.current &&
      start.plan.projectId === start.projectId &&
      current.plan.projectId === current.projectId &&
      current.plan === start.plan &&
      current.projectId === start.projectId &&
      current.floorId === start.floorId &&
      !current.uploading &&
      (!requireWrite || !current.editingDisabled)
    );
  }

  async function exportExchange() {
    const start = getCurrentContext();
    if (!start.floorId || start.uploading) return;
    const request = ++requestRef.current;
    setOperation("exporting");
    setError("");
    setMessage("");
    try {
      const exchange = await createCadExchange(start.plan, start.floorId);
      if (!unchangedContext(start, request, false)) return;
      downloadJson(
        exchange,
        `${safeFilename(projectName)}-${safeFilename(exchange.floorName)}-CAD交换.json`,
      );
      setMessage(
        `已导出 ${exchange.floorName} 的 ${exchange.points.length} 个点位。通过本机转换工具写入净底 DXF 后，即可在 Cadcraft 调整。`,
      );
    } catch (error) {
      if (unchangedContext(start, request, false)) setError(errorText(error));
    } finally {
      if (request === requestRef.current) setOperation(null);
    }
  }

  async function inspectSource(text: string, name: string, readingFile?: File) {
    const start = getCurrentContext();
    if (start.editingDisabled || start.uploading || !start.floorId) return;
    const request = ++requestRef.current;
    setOperation(readingFile ? "reading" : "checking");
    setError("");
    setMessage("");
    setPreview(null);
    try {
      const contents = readingFile ? await readingFile.text() : text;
      if (!unchangedContext(start, request, true)) return;
      setSource({ name, text: contents });
      const result = await previewCadReturn(start.plan, contents);
      if (!unchangedContext(start, request, true)) return;
      if (result.payload.exchange.floorId !== start.floorId) {
        throw new Error(
          `回传文件属于 ${result.payload.exchange.floorName}，请切换到对应楼层后重新读取。`,
        );
      }
      setPreview({ result, plan: start.plan });
      setMessage(
        result.changes.length
          ? "校验通过，当前方案尚未改动。请核对下方位置变化。"
          : "校验通过，所有点位位置均与当前方案一致，无需应用。",
      );
    } catch (error) {
      if (unchangedContext(start, request, true)) setError(errorText(error));
    } finally {
      if (request === requestRef.current) setOperation(null);
    }
  }

  async function readReturn(file: File | null) {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      setPreview(null);
      setSource(null);
      setMessage("");
      setError("CAD 回传文件超过 16 MB，请选择本机转换工具生成的 JSON 文件。");
      return;
    }
    await inspectSource("", file.name, file);
  }

  async function applyReturn() {
    const start = getCurrentContext();
    if (
      !preview ||
      preview.plan !== start.plan ||
      start.editingDisabled ||
      start.uploading ||
      preview.result.payload.exchange.floorId !== start.floorId
    )
      return;
    const request = ++requestRef.current;
    setOperation("applying");
    setError("");
    setMessage("");
    try {
      const result = await applyCadReturn(start.plan, preview.result.payload);
      if (!unchangedContext(start, request, true)) return;
      if (!onApply(result.plan, start.plan)) {
        throw new Error("方案已发生变化，请重新校验回传文件。");
      }
      setPreview(null);
      setMessage(
        `已调整 ${result.updated} 个点位，保留 ${result.unchanged} 个未变位置。移动点位与关联场景已转为待复核，请检查后保存草稿。`,
      );
    } catch (error) {
      if (unchangedContext(start, request, true)) setError(errorText(error));
    } finally {
      if (request === requestRef.current) setOperation(null);
    }
  }

  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Cadcraft 协作
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs leading-6 text-muted-foreground">
          导出当前楼层点位，通过本机转换工具生成 CAD 图纸；在 Cadcraft
          微调并保存后，生成回传文件，在这里核对位置并应用。
        </p>
        {floor?.cad ? (
          <div className="space-y-1 rounded-lg bg-muted/40 p-3">
            <p className="font-medium">
              已绑定净底：{floor.name} · {placedCount} 个已定位点位
            </p>
            <p className="break-words text-xs text-muted-foreground">
              CAD 坐标范围：({coordinate(floor.cad.window[0])},{" "}
              {coordinate(floor.cad.window[1])}) 至 (
              {coordinate(floor.cad.window[2])},{" "}
              {coordinate(floor.cad.window[3])})，Y 轴向上。
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
            当前楼层尚未绑定 CAD 净底。请先导入助手提供的、带 CAD
            配准信息的净底草稿，再导出点位到 Cadcraft。
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportExchange}
            disabled={!bound || !placedCount || uploading || busy}
          >
            <Download className="size-4" />
            {operation === "exporting" ? "正在导出…" : "导出 CAD 交换文件"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={!canWrite || busy}
          >
            <Upload className="size-4" />
            {operation === "reading" ? "正在读取…" : "读取 CAD 回传"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Cadcraft 回传文件"
            className="hidden"
            disabled={!canWrite || busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              void readReturn(file);
            }}
          />
          {source && (!preview || stale) && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || busy}
              onClick={() => inspectSource(source.text, source.name)}
            >
              <RefreshCw className="size-4" />
              {operation === "checking" ? "正在校验…" : "重新校验回传"}
            </Button>
          )}
        </div>
        {editingDisabled && (
          <p className="text-xs text-muted-foreground">
            当前为只读状态，可导出交换文件；调整坐标请返回可编辑草稿。
          </p>
        )}
        {uploading && (
          <p className="text-xs text-muted-foreground">
            底图正在读取，请完成后再交换 CAD 点位。
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-xs leading-6 text-muted-foreground">
            {message}
          </p>
        )}
        {stale && (
          <p
            role="status"
            className="text-xs text-amber-700 dark:text-amber-400"
          >
            方案已发生变化，原预览已失效。请重新校验回传文件。
          </p>
        )}
        {preview && !stale && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1">
              <p className="font-medium">
                {preview.result.payload.exchange.floorName} ·{" "}
                {preview.result.changes.length} 个位置变化 ·{" "}
                {preview.result.unchanged} 个未变
              </p>
              <p className="break-all text-xs text-muted-foreground">
                文件：{source?.name}
              </p>
              <p className="text-xs leading-6 text-muted-foreground">
                仅更新点位位置，保留产品、房间、灯组和场景内容。移动点位及关联场景需要重新复核。下列坐标为底图百分比。
              </p>
            </div>
            {preview.result.changes.length > 0 && (
              <ul
                aria-label="CAD 坐标调整预览"
                className="max-h-64 space-y-2 overflow-y-auto"
              >
                {preview.result.changes.map((change) => (
                  <li
                    key={change.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2 text-xs last:border-0 last:pb-0"
                  >
                    <span className="min-w-16 font-medium">{change.code}</span>
                    <span>
                      ({percent(change.from.x)}, {percent(change.from.y)})
                    </span>
                    <ArrowRight
                      className="size-3 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="font-medium">
                      ({percent(change.to.x)}, {percent(change.to.y)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              onClick={applyReturn}
              disabled={!canWrite || busy || !preview.result.changes.length}
            >
              {operation === "applying" ? "正在应用…" : "应用坐标调整"}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function coordinate(value: number) {
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: 1,
    useGrouping: false,
  });
}

function percent(value: number) {
  return `${value.toFixed(2)}%`;
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "读取失败，请检查 CAD 回传文件后重试。";
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100);
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
