"use client"

import { AppSidebar } from "@/components/app-sidebar"
import { OperationsDashboard } from "@/components/dashboard/operations-dashboard"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function Page() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          <OperationsDashboard />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
