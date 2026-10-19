// 报价单上的「规格」只展示简短卖点：产品库 spec 常是整段描述，夹带资料核实备注，
// 直接打印会挤占单价/总价列，也不该让客户看到。这里只做展示精简，不改产品数据。

const MAX_LENGTH = 26
const MAX_SEGMENTS = 2

// 资料整理过程中的内部备注，出现即整句丢弃
const INTERNAL_NOTE = /来源|说法|冲突|待.{0,6}核实|核实|渠道|供货|不填|wiring|标注|资料|未决|包装含/i
// 导入批次号等无意义编码，例如 XLSX-CLEAN-0514
const CODE_ONLY = /^[A-Z0-9_-]+$/

export function quoteDisplaySpec(spec: string | null | undefined, name = "") {
  const text = (spec ?? "").replace(/\s+/g, " ").trim()
  if (!text || CODE_ONLY.test(text)) return ""

  const compactName = name.replace(/\s+/g, "")
  const segments = text
    .split(/[；;。\n]|，(?=[^，]{6,})/)
    .map((part) => part.trim().replace(/^[，、,]+|[，、,]+$/g, ""))
    .filter((part) => part && !INTERNAL_NOTE.test(part) && !CODE_ONLY.test(part))
    // 「XX 系列，1 键配置」这类只是在重复产品名，跳过
    .filter((part) => !compactName || !compactName.includes(part.replace(/\s+/g, "").replace(/系列$/, "")))

  let result = ""
  for (const part of segments.slice(0, MAX_SEGMENTS)) {
    const next = result ? `${result}；${part}` : part
    if (next.length > MAX_LENGTH) {
      if (!result) result = `${part.slice(0, MAX_LENGTH - 1)}…`
      break
    }
    result = next
  }
  return result
}
