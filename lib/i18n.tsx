"use client"

import * as React from "react"

export type Locale = "en" | "zh"

type Dict = Record<string, string>

const en: Dict = {
  "brand.subtitle": "Next.js + shadcn/ui",
  "nav.general": "General",
  "nav.pages": "Pages",
  "nav.other": "Other",
  "nav.dashboard": "Dashboard",
  "nav.apps": "Apps",
  "nav.chats": "Chats",
  "nav.users": "Users",
  "nav.clerk": "Secured by Clerk",
  "nav.auth": "Auth",
  "nav.errors": "Errors",
  "nav.signIn": "Sign In",
  "nav.signUp": "Sign Up",
  "nav.forgotPassword": "Forgot Password",
  "nav.unauthorized": "Unauthorized",
  "nav.forbidden": "Forbidden",
  "nav.notFound": "Not Found",
  "nav.settings": "Settings",
  "user.upgrade": "Upgrade to Pro",
  "user.settings": "Settings",
  "user.account": "Account",
  "user.logout": "Log out",
  "header.search": "Search",
  "header.settings": "Settings",
  "header.language": "Language",
  "page.import": "Import",
  "page.create": "Create",
  "toolbar.filterPlaceholder": "Filter by title or ID...",
  "toolbar.reset": "Reset",
  "toolbar.view": "View",
  "toolbar.toggleColumns": "Toggle columns",
  "filter.status": "Status",
  "filter.priority": "Priority",
  "filter.selected": "selected",
  "filter.noResults": "No results found.",
  "filter.clear": "Clear filters",
  "table.task": "Work Order",
  "table.title": "Title",
  "table.status": "Status",
  "table.priority": "Priority",
  "table.noResults": "No results.",
  "row.edit": "Edit",
  "row.copy": "Make a copy",
  "row.favorite": "Favorite",
  "row.delete": "Delete",
  "row.openMenu": "Open menu",
  "page.rowsSelected": "{n} of {total} row(s) selected.",
  "page.rowsPerPage": "Rows per page",
  "page.pageOf": "Page {current} of {total}",
  "page.first": "First page",
  "page.previous": "Previous page",
  "page.next": "Next page",
  "page.last": "Last page",
  "status.backlog": "Backlog",
  "status.todo": "Todo",
  "status.in-progress": "In Progress",
  "status.done": "Done",
  "status.canceled": "Canceled",
  "priority.low": "Low",
  "priority.medium": "Medium",
  "priority.high": "High",
  "label.bug": "Bug",
  "label.feature": "Feature",
  "label.documentation": "Documentation",
}

const zh: Dict = {
  "brand.subtitle": "Next.js + shadcn/ui",
  "nav.general": "常规",
  "nav.pages": "页面",
  "nav.other": "其他",
  "nav.dashboard": "仪表盘",
  "nav.apps": "应用",
  "nav.chats": "聊天",
  "nav.users": "用户",
  "nav.clerk": "由 Clerk 保护",
  "nav.auth": "认证",
  "nav.errors": "错误页",
  "nav.signIn": "登录",
  "nav.signUp": "注册",
  "nav.forgotPassword": "忘记密码",
  "nav.unauthorized": "未授权",
  "nav.forbidden": "禁止访问",
  "nav.notFound": "未找到",
  "nav.settings": "设置",
  "user.upgrade": "升级到专业版",
  "user.settings": "设置",
  "user.account": "账户",
  "user.logout": "退出登录",
  "header.search": "搜索",
  "header.settings": "设置",
  "header.language": "语言",
  "page.import": "导入",
  "page.create": "新建",
  "toolbar.filterPlaceholder": "按标题或编号筛选...",
  "toolbar.reset": "重置",
  "toolbar.view": "视图",
  "toolbar.toggleColumns": "切换列",
  "filter.status": "状态",
  "filter.priority": "优先级",
  "filter.selected": "已选",
  "filter.noResults": "无匹配结果。",
  "filter.clear": "清除筛选",
  "table.task": "工单",
  "table.title": "标题",
  "table.status": "状态",
  "table.priority": "优先级",
  "table.noResults": "暂无数据。",
  "row.edit": "编辑",
  "row.copy": "创建副本",
  "row.favorite": "收藏",
  "row.delete": "删除",
  "row.openMenu": "打开菜单",
  "page.rowsSelected": "已选 {n} / {total} 行。",
  "page.rowsPerPage": "每页行数",
  "page.pageOf": "第 {current} / {total} 页",
  "page.first": "首页",
  "page.previous": "上一页",
  "page.next": "下一页",
  "page.last": "末页",
  "status.backlog": "待办池",
  "status.todo": "待办",
  "status.in-progress": "进行中",
  "status.done": "已完成",
  "status.canceled": "已取消",
  "priority.low": "低",
  "priority.medium": "中",
  "priority.high": "高",
  "label.bug": "缺陷",
  "label.feature": "功能",
  "label.documentation": "文档",
}

const dictionaries: Record<Locale, Dict> = { en, zh }

type I18nContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    if (typeof window === "undefined") {
      return "zh"
    }
    const stored = window.localStorage.getItem("locale") as Locale | null
    return stored === "en" || stored === "zh" ? stored : "zh"
  })

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l)
    window.localStorage.setItem("locale", l)
  }, [])

  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = dictionaries[locale][key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v))
        }
      }
      return str
    },
    [locale]
  )

  const value = React.useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = React.useContext(I18nContext)
  if (!ctx) {
    throw new Error("useI18n 必须在 I18nProvider 内使用")
  }
  return ctx
}
