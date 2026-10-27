/**
 * Next 的启动钩子：服务进程起来时执行一次。
 * 目前只用来排期官方产品资料的定时同步（没配 UPSTREAM_* 时什么都不做）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { startCatalogSyncSchedule } = await import("@/lib/catalog-sync-schedule")
  startCatalogSyncSchedule()
}
