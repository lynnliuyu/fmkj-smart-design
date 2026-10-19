import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getPageNumbers(currentPage: number, totalPages: number) {
  const delta = 1
  const range: Array<number | "..."> = []
  const rangeWithDots: Array<number | "..."> = []
  let previous: number | undefined

  for (let page = 1; page <= totalPages; page += 1) {
    if (
      page === 1 ||
      page === totalPages ||
      (page >= currentPage - delta && page <= currentPage + delta)
    ) {
      range.push(page)
    }
  }

  for (const page of range) {
    if (previous !== undefined && typeof page === "number") {
      if (page - previous === 2) {
        rangeWithDots.push(previous + 1)
      } else if (page - previous !== 1) {
        rangeWithDots.push("...")
      }
    }

    rangeWithDots.push(page)
    previous = typeof page === "number" ? page : previous
  }

  return rangeWithDots
}
