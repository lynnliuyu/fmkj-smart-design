import { listAdminProducts } from "@/lib/product-admin-service"
import { listProductDictionaries } from "@/lib/product-dictionaries"

import { ProductManagement } from "./product-management"

export default async function AdminProductsPage() {
  // 品牌/系列/型号来自受控字典：一次读出来传给表单，避免每个输入框各查一遍。
  const [products, dictionaries] = await Promise.all([listAdminProducts(), listProductDictionaries()])

  return <ProductManagement dictionaries={dictionaries} initialProducts={products} />
}
