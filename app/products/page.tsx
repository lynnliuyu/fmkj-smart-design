import { AppSidebar } from "@/components/app-sidebar"
import { ProductLibrary } from "@/components/products/product-library"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getCurrentAccountContext } from "@/lib/account-context"
import { isSuperAdminContext } from "@/lib/admin-auth"

export default async function ProductsPage() {
  const canManageProducts = isSuperAdminContext(await getCurrentAccountContext())

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-8">
          <ProductLibrary canManageProducts={canManageProducts} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
