"use client"

type CsvCell = string | number | boolean | null | undefined

export type CsvColumn<T> = {
  header: string
  value: (row: T) => CsvCell
}

export function downloadCsv<T>({
  columns,
  filename,
  rows,
}: {
  columns: CsvColumn<T>[]
  filename: string
  rows: T[]
}) {
  const csv = [
    columns.map((column) => escapeCsv(column.header)).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsv(column.value(row))).join(",")
    ),
  ].join("\r\n")
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: CsvCell) {
  const text = value == null ? "" : String(value)

  if (!/[",\r\n]/.test(text)) return text

  return `"${text.replaceAll('"', '""')}"`
}
