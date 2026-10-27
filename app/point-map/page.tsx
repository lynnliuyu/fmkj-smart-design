import { Suspense } from "react"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { PointMapWorkbench } from "@/components/projects/point-map-workbench"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireAccountPermission } from "@/lib/account-gates"
import { getCurrentAccountContext } from "@/lib/account-context"

export default async function PointMapPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>
}) {
  // 点位图只能从某个项目进入（页内不再有项目选择器），没带项目就去项目列表。
  const { projectId } = await searchParams
  if (!projectId) redirect("/projects")

  const accountContext = await getCurrentAccountContext()
  const pointMapGate = requireAccountPermission(accountContext, "point_map.use")

  if (!pointMapGate.allowed) {
    redirect(pointMapGate.reason === "NOT_AUTHENTICATED" ? "/login?from=/point-map" : "/errors/forbidden")
  }

  const readOnly = accountContext?.account.subscriptionStatus === "grace_period"

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        {/*
          SidebarInset 本身已经是 <main>，并用 [&>main]:max-w-7xl 限制直接子级宽度。
          点位图工作台需要占满窗口，所以这里用 div 而不是 main，避免被 1280px 居中约束。

          高度钉成「视口减去顶栏」：页面不再随内容变高，画布才可能吃掉剩余的全部高度。
          但窗口偏矮时（笔记本没最大化、浏览器底部挂了调试栏），固定高度会让画布被压扁
          ——实测 1366×560 下底图只剩 316×224，和改前一样小。
          所以这里允许纵向滚动，并且给画布一个最小高度（见工作台里的 min-h-[22rem]）：
          窗口够高就是一屏装下，窗口不够高就滚动，而不是把画布挤没。
        */}
        <div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 md:gap-3 md:p-3">
          <Suspense fallback={null}>
            <PointMapWorkbench readOnly={readOnly} />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
