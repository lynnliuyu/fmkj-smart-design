"use client";

import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ManagementBarAction = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: "default" | "secondary";
};

export function ManagementBar({
  actions,
  className,
  count,
  label,
}: {
  actions: ManagementBarAction[];
  className?: string;
  count: number;
  label: string;
}) {
  if (count <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "animate-ui-float flex flex-col gap-3 rounded-lg border bg-primary p-3 text-primary-foreground shadow-lg sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="text-sm font-medium">
        已选择 <span className="tabular-nums">{count}</span> 个{label}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <Button
              className={cn(
                "h-8 border-white/15",
                action.variant === "secondary"
                  ? "bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                  : "bg-primary-foreground text-primary hover:bg-primary-foreground/90",
              )}
              key={action.label}
              onClick={action.onClick}
              size="sm"
              type="button"
              variant={action.variant === "secondary" ? "outline" : "secondary"}
            >
              {Icon && <Icon className="size-4" />}
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
