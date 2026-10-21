"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronsUpDown,
  Command,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react"

import { clearAccountProfileCache, getInitials, useAccountProfile } from "@/components/account/use-account-profile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const navGeneral = [
  { icon: LayoutDashboard, label: "概览", url: "/" },
  { icon: FolderKanban, label: "项目", url: "/projects" },
  { icon: PackageSearch, label: "产品库", url: "/products" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { profile } = useAccountProfile()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const companyName = profile.companyName || "FMKJ"
  const userName = profile.name || "用户"
  const userContact = profile.email || profile.phone || "未设置账号"
  const canSeePlatformAdmin = profile.isSuperAdmin && profile.permissions.includes("platform.manage_features")

  function isActive(url: string) {
    if (url === "/") return pathname === "/"
    return url !== "#" && pathname.startsWith(url)
  }

  async function handleLogout() {
    if (isLoggingOut) return

    setIsLoggingOut(true)

    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      clearAccountProfileCache()
      router.replace("/login")
      router.refresh()
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="group-data-[collapsible=icon]:px-1.5">
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={profile.companyAvatarUrl ?? undefined} alt={companyName} className="rounded-lg" />
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {profile.companyAvatarUrl ? getInitials(companyName) : <Command className="size-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{companyName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {canSeePlatformAdmin ? "总平台管理" : "项目"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>常用</SidebarGroupLabel>
          <SidebarMenu>
            {navGeneral.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.label}>
                  <a href={item.url}>
                    <item.icon />
                    <span>{item.label}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {canSeePlatformAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>总平台</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/admin")} tooltip="平台管理">
                  <a href="/admin">
                    <ShieldCheck />
                    <span>平台管理</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage src={profile.avatarUrl ?? undefined} alt={userName} className="rounded-lg" />
                    <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs text-muted-foreground">{userContact}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side="top"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage src={profile.avatarUrl ?? undefined} alt={userName} className="rounded-lg" />
                      <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{userName}</span>
                      <span className="truncate text-xs text-muted-foreground">{userContact}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a href="/settings/account">
                      <Sparkles />
                      升级账号
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a href="/settings">
                      <Settings />
                      设置
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href="/settings/account">
                      <Users />
                      账户与团队
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isLoggingOut} onSelect={() => void handleLogout()}>
                  <LogOut />
                  {isLoggingOut ? "退出中" : "退出登录"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
