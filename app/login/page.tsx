import { redirect } from "next/navigation"

import { LoginScreen } from "@/components/auth/login-screen"
import { getFirstRunState } from "@/lib/first-run"
import { loginOptions } from "@/lib/login-options"

// 登录页要按请求判断「这台设备初始化了没有」，不能被静态预渲染：
// 构建时如果连得上一个空库，就会把「跳去初始化」烤进静态页面，初始化完成后仍然跳不过去。
export const dynamic = "force-dynamic"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  // 全新设备还没管理员：先去初始化页，客户自己设账号（装机脚本不带管理员密码）。
  const setup = await getFirstRunState()
  if (setup.needsSetup) redirect("/setup")

  const { from } = await searchParams
  const options = loginOptions()
  return (
    <main className="min-h-screen bg-background">
      <LoginScreen redirectTo={from || "/projects"} showSignUp={options.showSignUp} showSmsLogin={options.showSmsLogin} />
    </main>
  )
}
