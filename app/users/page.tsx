import { redirect } from "next/navigation"

/**
 * User management moved to the team settings screen, which is the only place
 * that talks to the live team service. This path keeps old links working.
 */
export default function UsersPage() {
  redirect("/settings/account")
}
