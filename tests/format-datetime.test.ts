import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime } from "../lib/format-datetime.js";

/**
 * 这组用例锁的是「服务端和浏览器必须渲染出同一个字符串」。
 *
 * 原来的写法是 `new Date(x).toLocaleString("zh-CN")`，服务端按 UTC、浏览器按用户时区，
 * 同一个时间戳两边结果不同，React 会报 hydration 不一致。所以下面刻意挑了
 * 跨日界的时刻：UTC 还是 10/19，东八区已经是 10/20。只要有人把时区钉死去掉，
 * 这两个用例在 UTC 环境下就会失败。
 */
describe("format-datetime", () => {
  it("按东八区渲染日期，不受进程时区影响", () => {
    expect(formatDate("2026-10-19T17:30:00Z")).toBe("2026/10/20");
    expect(formatDate("2026-10-19T15:59:59Z")).toBe("2026/10/19");
    expect(formatDate("2026-10-19T16:00:00Z")).toBe("2026/10/20");
  });

  it("按东八区渲染到分钟，24 小时制", () => {
    expect(formatDateTime("2026-10-19T17:30:00Z")).toBe("2026/10/20 01:30");
    expect(formatDateTime("2026-10-15T09:05:00Z")).toBe("2026/10/15 17:05");
    expect(formatDateTime("2026-10-15T16:05:00Z")).toBe("2026/10/16 00:05");
  });

  it("跨日界的时刻在两种时区下结果一致", () => {
    const value = "2026-10-19T17:30:00Z";

    // 同一份输入、同一个函数，任何进程环境下都必须给出同一个答案。
    expect(formatDateTime(value)).toBe(formatDateTime(value));
    expect(formatDate(value)).toBe("2026/10/20");
  });

  it("空值和非法时间回落到 fallback，不编造日期", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("")).toBe("-");
    expect(formatDate("不是时间")).toBe("-");
    expect(formatDateTime(null)).toBe("-");

    expect(formatDate(null, "未填写")).toBe("未填写");
    expect(formatDateTime("", "从未登录")).toBe("从未登录");
  });

  it("接受 Date 与毫秒时间戳", () => {
    const date = new Date("2026-10-19T17:30:00Z");

    expect(formatDateTime(date)).toBe("2026/10/20 01:30");
    expect(formatDateTime(date.getTime())).toBe("2026/10/20 01:30");
  });
});
