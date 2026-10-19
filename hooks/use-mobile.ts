import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // 初始值必须与服务端保持一致：服务端拿不到 window，
  // 若在首屏就读取 window.innerWidth，窄窗口（<768px）下客户端会渲染移动端分支，
  // 与服务端渲染的桌面端结构不符，导致 hydration 不一致。
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    // 挂载时同步一次真实值，之后交给媒体查询监听
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
