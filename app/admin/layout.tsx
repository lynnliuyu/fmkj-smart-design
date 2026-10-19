import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AdminTopNav } from "@/app/admin/_components/admin-top-nav"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin-auth"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireSuperAdmin()
  } catch (error) {
    if (error instanceof AdminAuthError && error.code === "UNAUTHORIZED") {
      redirect("/login?from=/admin")
    }

    if (error instanceof AdminAuthError) {
      redirect("/errors/forbidden")
    }

    throw error
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <AdminTopNav />
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
