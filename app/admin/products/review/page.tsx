import { listAdminProducts } from "@/lib/product-admin-service"
import { listProductDictionaries } from "@/lib/product-dictionaries"

import { ProductManagement } from "../product-management"

export default async function AdminProductReviewPage() {
  const [products, dictionaries] = await Promise.all([listAdminProducts("pending_review"), listProductDictionaries()])

  return <ProductManagement dictionaries={dictionaries} initialProducts={products} reviewOnly />
}
