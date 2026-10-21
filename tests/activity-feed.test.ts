import { describe, expect, it } from "vitest";

import {
  activityLogRowToFeedItem,
  formatDuration,
  formatDurationFromSeconds,
  formatRelativeTime,
  toActivityNotification,
  type ActivityLogRow,
} from "../lib/activity-feed.js";

describe("activity feed", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");

  it("formats relative time in Chinese labels", () => {
    expect(formatRelativeTime("2026-06-28T11:59:30.000Z", now)).toBe("刚刚");
    expect(formatRelativeTime("2026-06-28T11:45:00.000Z", now)).toBe(
      "15 分钟前",
    );
    expect(formatRelativeTime("2026-06-28T09:00:00.000Z", now)).toBe(
      "3 小时前",
    );
  });

  it("formats durations from date ranges and seconds", () => {
    expect(formatDuration("2026-06-28T11:40:00.000Z", now)).toBe("1 小时内");
    expect(formatDuration("2026-06-28T08:00:00.000Z", now)).toBe("4 小时");
    expect(formatDuration("2026-06-25T12:00:00.000Z", now)).toBe("3 天");
    expect(formatDurationFromSeconds(90 * 60)).toBe("2 小时");
  });

  it("maps persistent activity rows into feed items", () => {
    const row: ActivityLogRow = {
      action: "project.stage_advanced",
      actorName: "陈工",
      description: "陈工将项目推进到安装调试。",
      durationSeconds: 3 * 60 * 60,
      entityLabel: "华侨城全屋智能",
      entityType: "project",
      id: "activity_1",
      metadata: { toStage: "install" },
      occurredAt: "2026-06-28T10:00:00.000Z",
      title: "华侨城全屋智能 阶段已推进",
    };

    expect(activityLogRowToFeedItem(row, now)).toMatchObject({
      actor: "陈工",
      duration: "3 小时",
      iconKey: "map",
      kind: "project-advanced",
      subject: "华侨城全屋智能",
      time: "2 小时前",
      tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    });
  });

  it("preserves actor and duration for dashboard notifications", () => {
    const item = activityLogRowToFeedItem(
      {
        action: "quote.created",
        actorName: "设计",
        description: "设计生成 QT-EXAMPLE-DEMO。",
        durationSeconds: 60 * 60,
        entityLabel: "QT-EXAMPLE-DEMO",
        entityType: "quote",
        id: "activity_2",
        metadata: {},
        occurredAt: "2026-06-28T11:00:00.000Z",
        title: "华侨城全屋智能 报价已生成",
      },
      now,
    );

    expect(toActivityNotification(item)).toMatchObject({
      actor: "设计",
      duration: "1 小时",
      subject: "QT-EXAMPLE-DEMO",
      title: "华侨城全屋智能 报价已生成",
    });
  });
});
