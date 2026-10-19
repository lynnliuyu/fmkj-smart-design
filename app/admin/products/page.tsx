import { listAdminProducts } from "@/lib/product-admin-service"

import { ProductManagement } from "./product-management"

export default async function AdminProductsPage() {
  const products = await listAdminProducts()

  return <ProductManagement initialProducts={products} />
}
