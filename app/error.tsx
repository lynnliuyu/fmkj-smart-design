"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">出了点问题</h2>
        <p className="text-sm text-muted-foreground">
          页面加载时遇到了意外错误，请尝试刷新。
        </p>
      </div>
      <Button onClick={reset}>刷新重试</Button>
    </div>
  )
}
