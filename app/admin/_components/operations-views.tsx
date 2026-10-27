import { UpdatePanel } from "./update-panel"
import type { DatabaseStatus, EnvironmentStatus, ServerStatus } from "@/lib/platform-health"
import type { DeployStatus } from "@/lib/deploy-status"
import type { UpdateStatus } from "@/lib/deploy-update"
import type { PlatformSetting } from "@/lib/platform-settings"
import { formatDateTime } from "@/lib/format-datetime"
import { BackupPanel } from "@/app/admin/_components/backup-panel"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { SystemSettingsPanel } from "@/app/admin/_components/system-settings-panel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function SystemHealthView({
  database,
  deploy,
  environment,
  settings,
  server,
  update,
}: {
  database: DatabaseStatus
  deploy: DeployStatus
  environment: EnvironmentStatus
  settings: PlatformSetting[]
  server: ServerStatus
  update: UpdateStatus
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="系统健康" description="只读查看平台状态，所有密钥值均已脱敏。" />
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="环境" value={environment.ready ? "就绪" : "缺失"} tone={environment.ready ? "ok" : "warn"} />
        <Metric label="数据库" value={database.connected ? "已连接" : "离线"} tone={database.connected ? "ok" : "warn"} />
        <Metric label="运行时" value={runtimeLabel(server.runtime)} />
        <Metric label="版本" value={versionLabel(server.version)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>服务器</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <Info label="当前时间" value={formatDateTime(server.now, "时间未知")} />
          <Info label="Node 环境" value={nodeEnvLabel(server.nodeEnv)} />
          <Info label="数据库名称" value={database.database ?? "不可用"} />
          <Info label="数据库用户" value={database.user ?? "不可用"} />
        </CardContent>
      </Card>
      <DeployStatusCard deploy={deploy} />
      <UpdatePanel initial={update} />
      <BackupPanel />
      <SystemSettingsPanel initialSettings={settings} />
    </div>
  )
}

/**
 * 设备版的更新与备份状态。数值来自宿主机脚本写进 deploy-state 的 JSON：
 * 应用只读，不安装、不备份、不连网（ADR 0010：业务容器不持有 docker socket）。
 */
function DeployStatusCard({ deploy }: { deploy: DeployStatus }) {
  if (!deploy.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>软件更新与备份</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          这不是设备版部署，没有接入更新状态。设备版把 deploy-state 目录只读挂进容器后，这里会显示版本检查、更新结果和备份情况。
        </CardContent>
      </Card>
    )
  }

  const check = deploy.check
  const update = deploy.update
  const backup = deploy.backup

  return (
    <Card>
      <CardHeader>
        <CardTitle>软件更新与备份</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        <Info label="版本检查" value={checkLabel(check)} tone={check?.updateAvailable ? "warn" : undefined} />
        <Info
          label="版本清单来源"
          value={check?.signature === "verified" ? "已验签（确认是可信发布方）" : "未签名（只保证传输完整）"}
        />
        <Info label="上次更新" value={updateLabel(update)} />
        <Info label="上次备份" value={backupLabel(backup)} />
        <Info
          label="更新方式"
          value={update?.status === "running" ? "正在更新，请不要关闭设备" : "上面点一下就能装；不会在你不注意的时候自己装"}
        />
        <div className="rounded-md bg-muted/50 px-3 py-2 md:col-span-2">
          <div className="text-xs text-muted-foreground">手动更新命令（在设备的部署目录里执行）</div>
          <code className="mt-1 block break-all font-mono text-xs">
            node scripts/deploy/update-local.mjs --to &lt;目标版本&gt; --compose-file docker-compose.appliance.yml
          </code>
        </div>
      </CardContent>
    </Card>
  )
}

function checkLabel(check: DeployStatus["check"]): string {
  if (!check) return "还没有检查记录（设备上运行 scripts/deploy/check-update.mjs，或开启定时检查）"
  if (check.error) return `检查失败：${check.error}`
  if (check.updateAvailable) return `有新版本 ${check.latestVersion}（当前 ${check.currentVersion ?? "未知"}）`
  return `已是最新（${formatMoment(check.checkedAt)}）`
}

function updateLabel(update: DeployStatus["update"]): string {
  if (!update) return "还没有更新记录"
  if (update.status === "running") return `正在更新到 ${update.target}（${formatMoment(update.startedAt)}）`
  if (update.status === "succeeded") return `已更新到 ${update.target}（${formatMoment(update.finishedAt)}）`
  if (update.status === "failed-needs-restore") {
    return `更新到 ${update.target} 失败在「${update.failedStep ?? "未知"}」，数据库结构已推进，需要用备份恢复`
  }
  return `更新到 ${update.target} 失败在「${update.failedStep ?? "未知"}」，旧版本继续服务`
}

function backupLabel(backup: DeployStatus["backup"]): string {
  if (!backup) return "还没有备份记录"
  if (!backup.ok) return `上次备份失败：${backup.error ?? "未知原因"}`
  return `${formatMoment(backup.createdAt)}（保留 ${backup.kept ?? "?"} 份）`
}

function formatMoment(value: string | null): string {
  if (!value) return "时间未知"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : formatDateTime(parsed)
}

export function EnvironmentView({ environment }: { environment: EnvironmentStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="环境配置" description="仅显示配置是否存在，原始值不会离开服务端。" />
      {environment.groups.map((group) => (
        <PlatformListCard key={group.name} title={environmentGroupLabel(group.name)}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>配置项</TableHead>
                  <TableHead>技术标识</TableHead>
                  <TableHead>必需</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>{environmentKeyLabel(item.key)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.key}</TableCell>
                    <TableCell>{item.required ? "是" : "否"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={item.present ? "secondary" : "outline"}
                        className={
                          !item.present && item.required
                            ? "border-destructive/30 bg-destructive/10 text-destructive-strong"
                            : undefined
                        }
                      >
                        {item.present ? "已配置" : "缺失"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </PlatformListCard>
      ))}
    </div>
  )
}

export function DatabaseView({ database }: { database: DatabaseStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="数据库状态" description="查看运营相关表的连接状态、行数和结构可见性。" />
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="连接" value={database.connected ? "已连接" : "不可用"} tone={database.connected ? "ok" : "warn"} />
        <Metric label="总行数" value={database.totalRows.toLocaleString()} />
        <Metric label="错误代码" value={errorCodeLabel(database.errorCode)} />
      </div>
      <PlatformListCard title="数据表">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>数据表</TableHead>
                <TableHead className="text-right">行数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {database.tables.map((table) => (
                <TableRow key={table.name}>
                  <TableCell>
                    <div className="font-medium">{tableNameLabel(table.name)}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{table.name}</div>
                  </TableCell>
                  <TableCell className="text-right">{table.count?.toLocaleString() ?? "不可用"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </PlatformListCard>
    </div>
  )
}

function Metric({ label, tone, value }: { label: string; tone?: "ok" | "warn"; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className={tone === "warn" ? "text-2xl font-semibold text-destructive" : "text-2xl font-semibold"}>
          {value}
        </div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function Info({ label, tone, value }: { label: string; tone?: "ok" | "warn"; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === "warn" ? "mt-1 font-medium text-destructive" : "mt-1 font-medium"}>{value}</div>
    </div>
  )
}

function PageTitle({ description, title }: { description: string; title: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function runtimeLabel(runtime: string) {
  const labels: Record<string, string> = {
    nextjs: "Next.js 应用服务",
  }

  return withTechnicalName(labels[runtime], runtime)
}

function versionLabel(version: string) {
  if (version === "local") return "本地开发版本（local）"
  return version
}

function nodeEnvLabel(nodeEnv: string) {
  const labels: Record<string, string> = {
    development: "开发环境",
    production: "生产环境",
    test: "测试环境",
  }

  return withTechnicalName(labels[nodeEnv], nodeEnv)
}

function environmentGroupLabel(name: string) {
  const labels: Record<string, string> = {
    Authentication: "登录认证配置",
    Database: "数据库配置",
    Integrations: "外部集成配置",
  }

  return withTechnicalName(labels[name], name)
}

function environmentKeyLabel(key: string) {
  const labels: Record<string, string> = {
    BLOB_READ_WRITE_TOKEN: "文件存储读写令牌",
    DATABASE_SSL: "数据库 SSL 连接",
    DATABASE_URL: "数据库连接地址",
    DEV_AUTH_TOKEN: "开发登录令牌",
    FMKJ_API_BASE_URL: "外部产品接口地址",
    JWT_SECRET: "登录会话签名密钥",
  }

  return labels[key] ?? "自定义环境变量"
}

function tableNameLabel(name: string) {
  const labels: Record<string, string> = {
    account_profiles: "账号资料表",
    activity_logs: "操作日志表",
    feature_flags: "功能开关表",
    orders: "订单表",
    organization_members: "企业成员表",
    organizations: "企业客户表",
    plans: "套餐表",
    products: "产品表",
    project_members: "项目成员表",
    projects: "项目表",
    quote_items: "报价明细表",
    quotes: "报价单表",
    subscriptions: "订阅表",
    users: "用户表",
  }

  return labels[name] ?? "业务数据表"
}

function errorCodeLabel(code: string | null) {
  const labels: Record<string, string> = {
    DATABASE_CONNECTION_FAILED: "数据库连接失败",
    DATABASE_URL_MISSING: "缺少数据库连接地址",
  }

  if (!code) return "无"
  return withTechnicalName(labels[code], code)
}

function withTechnicalName(label: string | undefined, value: string) {
  return label ? `${label}（${value}）` : value
}
