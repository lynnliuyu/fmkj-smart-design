import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { QuoteBuilder } from "@/components/quotes/quote-builder"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function QuotesPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="[&>main]:mx-0 [&>main]:max-w-none">
        <SiteHeader />
        <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
          <Suspense fallback={null}>
            <QuoteBuilder />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
