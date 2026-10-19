import { AppSidebar } from "@/components/app-sidebar"
import { ErrorBoundary } from "@/components/common/error-boundary"
import { SiteHeader } from "@/components/site-header"
import { WorkOrdersClient } from "@/components/work-orders/work-orders-client"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getCurrentAccountContext } from "@/lib/account-context"
import { redirect } from "next/navigation"

export default async function WorkOrdersPage() {
  const context = await getCurrentAccountContext()
  if (!context) redirect("/login")

  const canManagePricing =
    context.account.type === "ENTERPRISE_OWNER" || context.account.isSuperAdmin

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <ErrorBoundary>
            <WorkOrdersClient canManagePricing={canManagePricing} />
          </ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
