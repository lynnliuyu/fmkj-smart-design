import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { ProjectWorkspace } from "@/components/projects/project-workspace"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <Suspense fallback={null}>
            <ProjectWorkspace projectId={id} />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
