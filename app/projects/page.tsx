import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { ProjectFlow } from "@/components/projects/project-flow"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function ProjectsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <Suspense fallback={null}>
            <ProjectFlow />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
