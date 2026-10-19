"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Languages, Menu, Monitor, Moon, SearchIcon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"

const headerNav = [
  { title: "概览", href: "/" },
  { title: "项目", href: "/projects" },
  { title: "方案报价", href: "/quotes" },
  { title: "合同", href: "/contracts" },
]

export function SiteHeader() {
  const pathname = usePathname()
  const { locale, setLocale, t } = useI18n()
  const [offset, setOffset] = React.useState(0)
  const showWorkbenchNav = isWorkbenchPath(pathname)

  React.useEffect(() => {
    function onScroll() {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    document.addEventListener("scroll", onScroll, { passive: true })

    return () => document.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header className={cn("sticky top-0 z-50 h-16 shrink-0", offset > 10 ? "shadow" : "shadow-none")}>
      <div
        className={cn(
          "relative flex h-full items-center gap-3 p-4 sm:gap-4",
          offset > 10 &&
            "after:absolute after:inset-0 after:-z-10 after:bg-background/20 after:backdrop-blur-lg"
        )}
      >
        <SidebarTrigger variant="outline" className="max-md:scale-125" />
        <Separator orientation="vertical" className="h-6" />
        {showWorkbenchNav ? <TopNav pathname={pathname} /> : null}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <SearchButton placeholder={t("header.search")} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("header.language")}>
                <Languages className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuLabel>{t("header.language")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={locale === "zh"}
                onCheckedChange={() => setLocale("zh")}
              >
                简体中文
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={locale === "en"}
                onCheckedChange={() => setLocale("en")}
              >
                English
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="ghost" size="icon" aria-label="通知">
            <Link href="/settings/notifications">
              <Bell className="size-5" />
            </Link>
          </Button>
          <ThemeMenu />
        </div>
      </div>
    </header>
  )
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname.startsWith(href)
}

function isWorkbenchPath(pathname: string) {
  return headerNav.some((item) => isActivePath(pathname, item.href))
}

function TopNav({ pathname }: { pathname: string }) {
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" className="md:size-7 lg:hidden">
            <Menu className="size-4" />
            <span className="sr-only">打开导航菜单</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start">
          {headerNav.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className={!isActivePath(pathname, item.href) ? "text-muted-foreground" : ""}>
                {item.title}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <nav className="mr-auto hidden items-center space-x-4 lg:flex lg:space-x-4 xl:space-x-6">
        {headerNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "text-sm font-medium transition-colors hover:text-primary",
              !isActivePath(pathname, item.href) && "text-muted-foreground"
            )}
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </>
  )
}

function ThemeMenu() {
  const { setTheme, theme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="主题">
          <Sun className="size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={theme === "light"} onCheckedChange={() => setTheme("light")}>
          <Sun className="size-4" />
          浅色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={theme === "dark"} onCheckedChange={() => setTheme("dark")}>
          <Moon className="size-4" />
          深色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={theme === "system"} onCheckedChange={() => setTheme("system")}>
          <Monitor className="size-4" />
          跟随系统
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SearchButton({ placeholder }: { placeholder: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="group relative h-8 w-full flex-1 justify-start rounded-md bg-muted/25 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:w-40 sm:pe-12 md:flex-none lg:w-52 xl:w-64"
      aria-keyshortcuts="Meta+K Control+K"
    >
      <SearchIcon
        aria-hidden="true"
        className="absolute inset-s-1.5 top-1/2 size-4 -translate-y-1/2"
      />
      <span className="ms-4">{placeholder}</span>
      <Kbd className="absolute inset-e-[0.3rem] top-[0.3rem] hidden rounded border bg-muted px-1.5 font-mono text-[10px] group-hover:bg-accent sm:flex">
        <span className="text-xs">⌘</span>K
      </Kbd>
    </Button>
  )
}
