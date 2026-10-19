"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileImage, Map, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProjectView = "point-map" | "quote" | "presentation";

const VIEW_LABELS: Record<ProjectView, string> = {
  "point-map": "点位设计",
  quote: "报价单",
  presentation: "客户交付",
};

function hrefFor(view: ProjectView, projectId: string) {
  if (view === "presentation") return `/projects/${encodeURIComponent(projectId)}/presentation`;
  const base = view === "point-map" ? "/point-map" : "/quotes";
  return `${base}?projectId=${encodeURIComponent(projectId)}`;
}

/**
 * 点位设计与报价单之间的切换按钮。离开当前页面前若有未保存修改，先询问是否保存。
 */
export function ProjectViewSwitch({
  active,
  projectId,
  hasUnsavedChanges,
  onSave,
}: {
  active: ProjectView;
  projectId: string;
  hasUnsavedChanges: () => boolean;
  onSave: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState<ProjectView | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  function go(view: ProjectView) {
    if (view === active) return;
    if (hasUnsavedChanges()) {
      setError("");
      setTarget(view);
      return;
    }
    router.push(hrefFor(view, projectId));
  }

  async function saveAndGo() {
    if (!target) return;
    setSaving(true);
    setError("");
    const saved = await onSave();
    setSaving(false);
    if (!saved) {
      setError("未能完成保存，已停留在当前页面，请检查后重试。");
      return;
    }
    router.push(hrefFor(target, projectId));
  }

  function discardAndGo() {
    if (!target) return;
    router.push(hrefFor(target, projectId));
  }

  const views: ProjectView[] = ["point-map", "quote", "presentation"];
  const icons = { "point-map": Map, quote: ReceiptText, presentation: FileImage } as const;

  return (
    <>
      <div role="group" aria-label="项目设计与交付流程" className="inline-flex flex-wrap rounded-md border p-0.5">
        {views.map((view) => {
          const Icon = icons[view];
          const isActive = view === active;
          return (
            <Button
              key={view}
              type="button"
              size="sm"
              variant={isActive ? "secondary" : "ghost"}
              aria-current={isActive ? "page" : undefined}
              onClick={() => go(view)}
            >
              <Icon className="size-4" />
              {VIEW_LABELS[view]}
            </Button>
          );
        })}
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !saving) setTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存当前修改？</DialogTitle>
            <DialogDescription>
              {VIEW_LABELS[active]}有未保存的修改。切换到{target ? VIEW_LABELS[target] : ""}前，是否先保存？不保存的修改可能无法恢复。
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={discardAndGo}>
              不保存并切换
            </Button>
            <Button type="button" disabled={saving} onClick={saveAndGo}>
              {saving ? "保存中…" : "保存并切换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
