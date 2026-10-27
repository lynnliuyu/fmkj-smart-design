"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FileText, FolderKanban, LayoutDashboard, PackageSearch, Settings } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

type ProjectOption = {
  id: string
  name: string
  code?: string | null
  customer?: string | null
  community?: string | null
  stageStatusLabel?: string | null
}

const PAGES = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/products", label: "产品库", icon: PackageSearch },
  { href: "/quotes", label: "方案报价", icon: FileText },
  { href: "/settings", label: "设置", icon: Settings },
] as const

/**
 * 顶栏那个搜索框原本是个没有 onClick 的按钮，写着 ⌘K 却什么都不做。
 * 这里把它做成真的：一个入口，直接跳到某个项目或某个页面。
 *
 * 项目列表在第一次打开时才拉，拉过一次就留在内存里；失败时给出可重试的提示，
 * 而不是显示成「没有结果」。
 */
export function QuickJump() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [projects, setProjects] = React.useState<ProjectOption[] | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setOpen((value) => !value)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const loadProjects = React.useCallback(async () => {
    setFailed(false)
    try {
      const response = await fetch("/api/projects")
      if (!response.ok) throw new Error(String(response.status))
      const payload = (await response.json()) as { data?: ProjectOption[] }
      setProjects(payload.data ?? [])
    } catch {
      setProjects(null)
      setFailed(true)
    }
  }, [])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && projects === null && !failed) void loadProjects()
  }

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className="group relative h-8 w-full flex-1 cursor-text justify-start rounded-md border bg-muted/25 pe-12 ps-8 text-start text-sm font-normal text-muted-foreground shadow-none transition-colors hover:bg-accent sm:w-40 md:flex-none lg:w-52 xl:w-64"
      >
        <SearchGlyph />
        <span className="block truncate">搜索项目</span>
        <KbdHint />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="快速跳转"
        description="搜索项目或页面，回车打开"
        className="sm:max-w-lg"
      >
        <CommandInput placeholder="输入项目名、编号、客户或页面名" autoFocus />
        <CommandList>
          {failed ? (
            <div className="px-3 py-6 text-center text-sm">
              <p className="text-foreground">项目列表没加载出来</p>
              <p className="mt-1 text-muted-foreground">检查网络后重试，或直接从左侧「项目」进入。</p>
              <button
                type="button"
                onClick={() => void loadProjects()}
                className="mt-3 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                重新加载
              </button>
            </div>
          ) : (
            <>
              <CommandEmpty>
                {projects === null ? "正在读取项目…" : "没有匹配的项目或页面。"}
              </CommandEmpty>

              {projects && projects.length > 0 ? (
                <CommandGroup heading="项目">
                  {projects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={`${project.name} ${project.code ?? ""} ${project.customer ?? ""} ${project.community ?? ""}`}
                      onSelect={() => go(`/projects/${project.id}`)}
                    >
                      <FolderKanban className="text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                      <span className="ms-auto shrink-0 ps-3 text-xs text-muted-foreground">
                        {project.stageStatusLabel ?? project.code ?? ""}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {projects && projects.length > 0 ? <CommandSeparator /> : null}

              <CommandGroup heading="页面">
                {PAGES.map((page) => (
                  <CommandItem key={page.href} value={page.label} onSelect={() => go(page.href)}>
                    <page.icon className="text-muted-foreground" />
                    <span>{page.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute inset-s-2.5 top-1/2 size-4 -translate-y-1/2"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function KbdHint() {
  return (
    <span className="pointer-events-none absolute inset-e-1.5 top-1/2 hidden -translate-y-1/2 items-center rounded border bg-muted px-1.5 py-0.5 text-xs leading-none text-muted-foreground group-hover:bg-accent sm:flex">
      ⌘K
    </span>
  )
}
