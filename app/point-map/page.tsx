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
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <Suspense fallback={null}>
            <PointMapWorkbench readOnly={readOnly} />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
