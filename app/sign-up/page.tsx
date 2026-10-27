import { redirect } from "next/navigation"

import { SignUpScreen } from "@/components/auth/sign-up-screen"
import { selfSignupAllowed } from "@/lib/self-signup"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  // 设备版不开放自助注册：这一页直接回到登录页，别让客户白填一遍。
  if (!selfSignupAllowed()) redirect("/login")

  const { from } = await searchParams
  return (
    <main className="min-h-screen bg-background">
      <SignUpScreen redirectTo={from || "/projects"} />
    </main>
  )
}
