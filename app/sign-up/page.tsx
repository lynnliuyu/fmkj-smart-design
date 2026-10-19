import { SignUpScreen } from "@/components/auth/sign-up-screen"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  return (
    <main className="min-h-screen bg-background">
      <SignUpScreen redirectTo={from || "/projects"} />
    </main>
  )
}
