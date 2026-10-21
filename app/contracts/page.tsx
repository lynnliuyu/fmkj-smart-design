import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { ContractsWorkbench } from "@/components/contracts/contracts-workbench"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function ContractsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <Suspense fallback={null}>
            <ContractsWorkbench />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
