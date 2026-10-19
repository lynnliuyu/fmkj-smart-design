"use client"

import * as React from "react"

export type AccountProfile = {
  accountType: string | null
  avatarUrl: string | null
  companyAvatarUrl: string | null
  companyId: string | null
  companyName: string | null
  email: string | null
  isSuperAdmin: boolean
  name: string
  permissions: string[]
  phone: string | null
}

const defaultProfile: AccountProfile = {
  accountType: null,
  avatarUrl: null,
  companyAvatarUrl: null,
  companyId: null,
  companyName: null,
  email: null,
  isSuperAdmin: false,
  name: "用户",
  permissions: [],
  phone: null,
}

const profileStorageKey = "fmkj.account.profile"
let cachedProfile: AccountProfile | null = null
let inflightProfileRequest: Promise<AccountProfile | null> | null = null

export function useAccountProfile() {
  // 初始状态固定为 defaultProfile：服务端渲染读不到 sessionStorage，
  // 客户端首屏若直接读缓存会与服务端不一致（例如侧边栏显示"总平台管理" vs "项目"），
  // 导致 hydration 失败。缓存改为挂载后再应用。
  const [profile, setProfileState] = React.useState<AccountProfile>(defaultProfile)
  const [loading, setLoading] = React.useState(true)

  const setProfile = React.useCallback((next: Partial<AccountProfile>) => {
    setProfileState((current) => {
      const merged = { ...current, ...next }
      cacheProfile(merged)
      return merged
    })
  }, [])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const nextProfile = await fetchAccountProfile()
      if (nextProfile) setProfile(nextProfile)
    } finally {
      setLoading(false)
    }
  }, [setProfile])

  React.useEffect(() => {
    // 缓存和刷新都在挂载后的同一回调中开始，首帧继续与服务端保持一致。
    const timer = window.setTimeout(() => {
      const cached = getCachedProfile()
      if (cached) setProfileState(cached)
      void reload()
    }, 0)

    function onProfileUpdated(event: Event) {
      const detail = (event as CustomEvent<Partial<AccountProfile>>).detail
      if (detail) setProfile(detail)
      else void reload()
    }

    window.addEventListener("account-profile-updated", onProfileUpdated)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("account-profile-updated", onProfileUpdated)
    }
  }, [reload, setProfile])

  return { loading, profile, reload, setProfile }
}

export function notifyAccountProfileUpdated(profile: Partial<AccountProfile>) {
  window.dispatchEvent(new CustomEvent("account-profile-updated", { detail: profile }))
}

export function clearAccountProfileCache() {
  cachedProfile = null
  if (typeof window === "undefined") return

  try {
    window.sessionStorage.removeItem(profileStorageKey)
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function getInitials(value: string | null | undefined) {
  const text = String(value ?? "").trim()
  if (!text) return "用户"

  const compact = text.replace(/\s+/g, "")
  const asciiParts = text.split(/\s+/).filter(Boolean)
  if (asciiParts.length > 1) {
    return asciiParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
  }

  return compact.slice(0, 2).toUpperCase()
}

async function fetchAccountProfile() {
  if (!inflightProfileRequest) {
    inflightProfileRequest = fetch("/api/account/profile", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { profile?: Partial<AccountProfile> }
        if (!response.ok || !data.profile) return null

        const profile = { ...defaultProfile, ...data.profile }
        cacheProfile(profile)
        return profile
      })
      .finally(() => {
        inflightProfileRequest = null
      })
  }

  return inflightProfileRequest
}

function getCachedProfile() {
  if (cachedProfile) return cachedProfile
  if (typeof window === "undefined") return null

  try {
    const raw = window.sessionStorage.getItem(profileStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AccountProfile>
    cachedProfile = { ...defaultProfile, ...parsed }
    return cachedProfile
  } catch {
    return null
  }
}

function cacheProfile(profile: AccountProfile) {
  cachedProfile = profile
  if (typeof window === "undefined") return

  try {
    window.sessionStorage.setItem(profileStorageKey, JSON.stringify(profile))
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
