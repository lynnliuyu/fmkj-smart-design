import { listAdminProducts } from "@/lib/product-admin-service"

import { ProductManagement } from "../product-management"

export default async function AdminProductReviewPage() {
  const products = await listAdminProducts("pending_review")

  return <ProductManagement initialProducts={products} reviewOnly />
}
