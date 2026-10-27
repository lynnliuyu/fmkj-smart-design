import { Suspense } from "react"

// 这一页要读客户在系统配置里填的公司名/logo；不写死成动态的话，构建时会被预渲染成
// 默认品牌并缓存，客户改了自己的公司名也看不到变化（真机验证时踩到）。
export const dynamic = "force-dynamic"

import { AppSidebar } from "@/components/app-sidebar"
import { QuoteBuilder } from "@/components/quotes/quote-builder"
import { resolveDocumentBrand } from "@/lib/document-brand"
import { listPlatformSettings } from "@/lib/platform-settings"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default async function QuotesPage() {
  // 报价单上印谁的名字：客户在「系统配置」里填过就用他的，没填用默认品牌。
  const brand = resolveDocumentBrand(await listPlatformSettings())

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="[&>main]:mx-0 [&>main]:max-w-none">
        <SiteHeader />
        <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
          <Suspense fallback={null}>
            <QuoteBuilder brand={brand} />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
