"use client"

import * as React from "react"

type Props = {
  children: React.ReactNode
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: null }))
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <div className="text-base font-semibold">页面渲染出错</div>
          <pre className="whitespace-pre-wrap break-words text-xs">{error.message}</pre>
          <pre className="whitespace-pre-wrap break-words text-xs text-red-600/80">
            {error.stack?.split("\n").slice(0, 8).join("\n")}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 inline-flex h-8 w-fit items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}