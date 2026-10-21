import { Suspense } from "react"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { PointMapWorkbench } from "@/components/projects/point-map-workbench"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireAccountPermission } from "@/lib/account-gates"
import { getCurrentAccountContext } from "@/lib/account-context"

export default async function PointMapPage() {
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
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:gap-3 md:p-3">
          <Suspense fallback={null}>
            <PointMapWorkbench readOnly={readOnly} />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
