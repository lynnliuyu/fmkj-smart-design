import { redirect } from "next/navigation"

import { SetupScreen } from "@/components/auth/setup-screen"
import { getFirstRunState } from "@/lib/first-run"

export const dynamic = "force-dynamic"

/**
 * 设备首次打开的初始化页。已经初始化过的设备访问这里会回到登录页——
 * 不能用它来覆盖已有管理员（守卫在 lib/first-run.ts 的 SQL 里，这里只是提前拦一下）。
 */
export default async function SetupPage() {
  const state = await getFirstRunState()
  if (!state.needsSetup) redirect("/login")

  return (
    <main className="min-h-screen bg-background">
      <SetupScreen />
    </main>
  )
}
