export type FallbackProduct = {
  id: string
  name: string
  brand: string
  platform: string
  category: string
  sku: string
  unit: string
  price: number
  cost: number
  stock: number
  image: string
  description: string
  tags: string[]
  channels: string[]
  status: "active"
}

export const fallbackProducts: FallbackProduct[] = []
