import { describe, expect, it } from "vitest"

import {
  buildWorkbenchNav,
  isWorkbenchPrimaryTab,
  legacyWorkspaceTabHref,
  normalizeWorkspaceTab,
  pageOwnedWorkspaceTabs,
  readWorkbenchProjectId,
  showsWorkbenchNav,
  WORKBENCH_BASIC_TAB,
  WORKBENCH_QUOTE_TAB,
  WORKBENCH_WORKSPACE_TABS,
} from "../lib/workbench-nav"

function hrefsOf(pathname: string, search = "") {
  return Object.fromEntries(buildWorkbenchNav(pathname, search).map((item) => [item.key, item.href]))
}

function activeKeys(pathname: string, search = "") {
  return buildWorkbenchNav(pathname, search)
    .filter((item) => item.active)
    .map((item) => item.key)
}

describe("workbench header navigation", () => {
  it("把概览移出顶部栏，只保留项目、方案报价和合同", () => {
    expect(buildWorkbenchNav("/", "").map((item) => item.title)).toEqual(["项目", "方案报价", "合同"])
  })

  it("不在项目内时指向全局列表", () => {
    expect(hrefsOf("/projects")).toEqual({
      project: "/projects",
      quote: "/quotes",
      contract: "/contracts",
    })
  })

  it("进入项目后方案报价直接落到该项目的方案报价页，合同带上 projectId 直进合同页", () => {
    expect(hrefsOf("/projects/p1", "")).toEqual({
      project: "/projects/p1",
      quote: "/projects/p1?tab=solution-quote",
      contract: "/contracts?projectId=p1",
    })
  })

  it("沿用 projectId 查询参数，让点位设计与报价页保持同一个项目", () => {
    expect(readWorkbenchProjectId("/point-map", "?projectId=p1")).toBe("p1")
    expect(hrefsOf("/point-map", "?projectId=p1").quote).toBe("/projects/p1?tab=solution-quote")
    expect(hrefsOf("/quotes", "?projectId=p1").contract).toBe("/contracts?projectId=p1")
  })

  it("按当前标签页高亮入口", () => {
    expect(activeKeys("/projects/p1")).toEqual(["project"])
    expect(activeKeys("/projects/p1", "?tab=solution-quote")).toEqual(["quote"])
    expect(activeKeys("/contracts", "?projectId=p1")).toEqual(["contract"])
    // 执行与资料里的次要标签仍归属项目入口。
    expect(activeKeys("/projects/p1", "?tab=members")).toEqual(["project"])
  })

  it("旧的执行类段落地址转到各自业务页，不再静默变成资料", () => {
    expect(legacyWorkspaceTabHref("contract", "p1")).toBe("/contracts?projectId=p1")
    expect(legacyWorkspaceTabHref("delivery", "p1")).toBe("/projects/p1/presentation")
    for (const value of [null, "", "basic", "solution-quote", "members", "not-a-tab"]) {
      expect(legacyWorkspaceTabHref(value, "p1"), String(value)).toBeNull()
    }
    expect(legacyWorkspaceTabHref("delivery", "小区/一栋 101")).toBe(`/projects/${encodeURIComponent("小区/一栋 101")}/presentation`)
  })

  it("把点位设计与报价单都算作方案报价工作流", () => {
    expect(activeKeys("/point-map", "?projectId=p1")).toEqual(["quote"])
    expect(activeKeys("/quotes", "?projectId=p1")).toEqual(["quote"])
    expect(activeKeys("/quotes")).toEqual(["quote"])
    expect(activeKeys("/contracts")).toEqual(["contract"])
  })

  it("概览页保留入口但不误高亮任何一项", () => {
    expect(activeKeys("/")).toEqual([])
  })

  it("项目 ID 经过编码往返后保持稳定", () => {
    const encoded = encodeURIComponent("小区/一栋 101")
    expect(readWorkbenchProjectId(`/projects/${encoded}`, "")).toBe("小区/一栋 101")
    expect(hrefsOf(`/projects/${encoded}`).quote).toBe(`/projects/${encoded}?tab=solution-quote`)
  })

  it("顶部栏主入口与项目工作台段落共用同一套取值", () => {
    expect([WORKBENCH_BASIC_TAB, WORKBENCH_QUOTE_TAB]).toEqual(["basic", "solution-quote"])
    // 顶部栏负责的两段不在页内「执行与资料」重复出现。
    for (const value of [WORKBENCH_BASIC_TAB, WORKBENCH_QUOTE_TAB]) {
      expect(isWorkbenchPrimaryTab(value), value).toBe(true)
    }
    for (const value of ["contract", "delivery", "members"]) {
      expect(isWorkbenchPrimaryTab(value), value).toBe(false)
    }
  })

  it("项目内只保留成员这一个段落", () => {
    expect(pageOwnedWorkspaceTabs().map((tab) => tab.label)).toEqual(["成员"])
    expect(pageOwnedWorkspaceTabs().map((tab) => tab.value)).toEqual(["members"])
    expect(WORKBENCH_WORKSPACE_TABS).toHaveLength(3)
    // 执行类业务不再是项目内段落。
    for (const value of ["contract", "delivery"]) {
      expect(WORKBENCH_WORKSPACE_TABS.some((tab) => tab.value === value), value).toBe(false)
    }
  })

  it("兼容历史段落参数，未知值回到资料", () => {
    expect(normalizeWorkspaceTab(null)).toBe(WORKBENCH_BASIC_TAB)
    expect(normalizeWorkspaceTab("")).toBe(WORKBENCH_BASIC_TAB)
    expect(normalizeWorkspaceTab("not-a-tab")).toBe(WORKBENCH_BASIC_TAB)
    expect(normalizeWorkspaceTab("point-map")).toBe(WORKBENCH_QUOTE_TAB)
    expect(normalizeWorkspaceTab("quote")).toBe(WORKBENCH_QUOTE_TAB)
    // 执行类段落已经移出项目页，由 legacyWorkspaceTabHref 转走。
    for (const value of ["contract", "delivery"]) {
      expect(normalizeWorkspaceTab(value), value).toBe(WORKBENCH_BASIC_TAB)
    }
    for (const tab of WORKBENCH_WORKSPACE_TABS) {
      expect(normalizeWorkspaceTab(tab.value)).toBe(tab.value)
    }
  })

  it("只在工作台页面显示顶部栏", () => {
    for (const pathname of ["/", "/projects", "/projects/p1", "/quotes", "/contracts", "/point-map"]) {
      expect(showsWorkbenchNav(pathname), pathname).toBe(true)
    }
    // 平台管理页也保留工作台导航，方便超级管理员回到业务侧。
    for (const pathname of ["/admin", "/admin/customers", "/admin/products"]) {
      expect(showsWorkbenchNav(pathname), pathname).toBe(true)
    }
    for (const pathname of ["/products", "/settings", "/projects-archive"]) {
      expect(showsWorkbenchNav(pathname), pathname).toBe(false)
    }
  })
})
