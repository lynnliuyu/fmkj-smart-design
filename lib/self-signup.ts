/**
 * 是否允许陌生人自助注册账号。
 *
 * 托管版靠自助注册拉新客（默认开着，行为不变）；**设备版不该开**：设备是客户自己买的机器，
 * 一旦通过内网穿透暴露到公网，谁都能在上面注册一个账号，看到同实例里的产品库。
 * 设备版编排里把 FMKJ_ALLOW_SELF_SIGNUP 设为 false。
 *
 * 注意区分：这里关的是「陌生人自己注册」；管理员在后台添加成员不受影响。
 */
export const SELF_SIGNUP_CLOSED_MESSAGE =
  "这台设备不开放自助注册。请让管理员在「管理员 → 账号管理」里给你开账号。"

export function selfSignupAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const configured = String(env.FMKJ_ALLOW_SELF_SIGNUP ?? "").trim().toLowerCase()
  if (configured === "false" || configured === "0" || configured === "no") return false
  // 没配置时保持原有行为（托管版与本地开发都不受影响）。
  return true
}
