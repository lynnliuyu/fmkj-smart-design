/**
 * 顶部栏工作台导航，以及项目工作台的段落取值。
 *
 * 「概览」已移到侧边栏，顶部栏只保留三个入口：项目（资料）、方案报价、合同。
 * 项目内不再重复选项目：方案报价落到该项目的方案报价段落，合同直接进合同页并带上 projectId。
 * 执行类业务（客户交付）不再占用项目内段落，只在「执行与资料」里直达；
 * 旧的 ?tab=contract / delivery 由 legacyWorkspaceTabHref 转去对应页面。
 */

export type WorkbenchNavKey = "project" | "quote" | "contract"

export type WorkbenchNavItem = {
  key: WorkbenchNavKey
  title: string
  href: string
  active: boolean
}

/** 项目工作台的方案报价段落（顶部栏「方案报价」的落点）。 */
export const WORKBENCH_QUOTE_TAB = "solution-quote"
/** 项目工作台的资料段落，也是项目入口的默认段落。 */
export const WORKBENCH_BASIC_TAB = "basic"

/**
 * 项目工作台里真正留在项目内的段落；图标由工作台组件按取值映射。
 * 合同 / 交付不再占段落，改为直达各自的业务页面。
 */
export const WORKBENCH_WORKSPACE_TABS = [
  { value: WORKBENCH_BASIC_TAB, label: "资料" },
  { value: WORKBENCH_QUOTE_TAB, label: "方案报价" },
  { value: "members", label: "成员" },
] as const

export type WorkbenchWorkspaceTab = (typeof WORKBENCH_WORKSPACE_TABS)[number]["value"]

const WORKSPACE_TAB_VALUES = new Set<string>(WORKBENCH_WORKSPACE_TABS.map((tab) => tab.value))

/**
 * 顶部栏已经承担这两个主入口，项目工作台页内不再重复提供，只把其余段落收进「执行与资料」。
 */
export function isWorkbenchPrimaryTab(value: string) {
  return value === WORKBENCH_BASIC_TAB || value === WORKBENCH_QUOTE_TAB
}

/** 页内「执行与资料」负责的段落：顶部栏主入口之外的其余段落。 */
export function pageOwnedWorkspaceTabs() {
  return WORKBENCH_WORKSPACE_TABS.filter((tab) => !isWorkbenchPrimaryTab(tab.value))
}

/** 兼容历史地址参数：point-map / quote 落到方案报价；无参数或未知值回到资料。 */
export function normalizeWorkspaceTab(value: string | null): WorkbenchWorkspaceTab {
  if (value === "point-map" || value === "quote") return WORKBENCH_QUOTE_TAB
  if (value && WORKSPACE_TAB_VALUES.has(value)) return value as WorkbenchWorkspaceTab
  return WORKBENCH_BASIC_TAB
}

/**
 * 旧的项目内段落地址：不再作为段落，但直达地址仍然可用，转到对应的业务页面。
 * 返回 null 表示不是旧段落地址。
 */
export function legacyWorkspaceTabHref(value: string | null, projectId: string) {
  const encoded = encodeURIComponent(projectId)

  switch (value) {
    case "contract":
      return `/contracts?projectId=${encoded}`
    case "delivery":
      return `/projects/${encoded}/presentation`
    default:
      return null
  }
}

const PROJECT_DETAIL_PATTERN = /^\/projects\/([^/?#]+)/
const WORKBENCH_PREFIXES = ["/projects", "/quotes", "/contracts", "/point-map", "/admin"]

function decodeProjectId(raw: string) {
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

/**
 * 从地址中还原当前项目 ID：项目详情路径优先，其次读取 projectId 查询参数。
 * 点位设计、报价单等页面用 projectId 携带项目上下文。
 */
export function readWorkbenchProjectId(pathname: string, search: string) {
  const detail = PROJECT_DETAIL_PATTERN.exec(pathname)
  if (detail) {
    const id = decodeProjectId(detail[1])
    if (id) return id
  }

  const fromQuery = new URLSearchParams(search).get("projectId")
  return fromQuery?.trim() ? fromQuery.trim() : null
}

/** 顶部栏只在这些工作台页面出现：概览、项目、方案报价、合同、点位设计、平台管理。 */
export function showsWorkbenchNav(pathname: string) {
  if (pathname === "/") return true
  return WORKBENCH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function buildWorkbenchNav(pathname: string, search: string): WorkbenchNavItem[] {
  const projectId = readWorkbenchProjectId(pathname, search)
  const projectPath = projectId ? `/projects/${encodeURIComponent(projectId)}` : null
  const tab = new URLSearchParams(search).get("tab")

  // 点位设计与报价单都属于「方案报价」这条连续工作流，共用同一个高亮入口。
  const quoteActive =
    pathname === "/quotes" ||
    pathname.startsWith("/quotes/") ||
    pathname === "/point-map" ||
    pathname.startsWith("/point-map/") ||
    (projectPath !== null && tab === WORKBENCH_QUOTE_TAB)
  const contractActive = pathname === "/contracts" || pathname.startsWith("/contracts/")
  const projectActive = !quoteActive && !contractActive && (pathname === "/projects" || pathname.startsWith("/projects/"))

  return [
    {
      key: "project",
      title: "项目",
      href: projectPath ?? "/projects",
      active: projectActive,
    },
    {
      key: "quote",
      title: "方案报价",
      href: projectPath ? `${projectPath}?tab=${WORKBENCH_QUOTE_TAB}` : "/quotes",
      active: quoteActive,
    },
    {
      key: "contract",
      title: "合同",
      href: projectId ? `/contracts?projectId=${encodeURIComponent(projectId)}` : "/contracts",
      active: contractActive,
    },
  ]
}
