import { redirect } from "next/navigation"

/**
 * The management screen that used to live here was backed by the retired
 * in-memory account services and had no navigation entry. Customer accounts are
 * managed at /admin/customers, so this path only keeps old bookmarks working.
 */
export default function AccountSystemPage() {
  redirect("/admin/customers")
}
