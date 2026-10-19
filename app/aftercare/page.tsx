import { AppSidebar } from "@/components/app-sidebar"
import { AftercareWorkbench } from "@/components/aftercare/aftercare-workbench"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function AftercarePage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <AftercareWorkbench />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
