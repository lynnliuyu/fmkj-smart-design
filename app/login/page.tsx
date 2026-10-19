import { LoginScreen } from "@/components/auth/login-screen"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  return (
    <main className="min-h-screen bg-background">
      <LoginScreen redirectTo={from || "/projects"} />
    </main>
  )
}
