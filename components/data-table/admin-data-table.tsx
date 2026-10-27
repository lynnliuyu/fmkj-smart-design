"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Settings2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type AdminDataTableFilter = {
  columnId: string
  options: {
    icon?: React.ComponentType<{ className?: string }>
    label: string
    value: string
  }[]
  title: string
}

const PAGE_SIZE_OPTIONS = [5, 10, 20]
const MIN_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]
/** 少于这个数量的可隐藏列就不给「列显示」入口：四列的表格藏一列没有意义。 */
const MIN_HIDEABLE_COLUMNS_FOR_PICKER = 5

type AdminDataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  emptyText?: string
  filters?: AdminDataTableFilter[]
  getRowId?: (row: TData) => string
  globalFilter?: string
  globalFilterFn?: (row: TData, filterValue: string) => boolean
  onGlobalFilterChange?: (value: string) => void
  onRowClick?: (row: TData) => void
  searchPlaceholder?: string
  selectedRowId?: string
}

export function AdminDataTable<TData, TValue>({
  columns,
  data,
  emptyText = "没有结果",
  filters = [],
  getRowId,
  globalFilter: controlledGlobalFilter,
  globalFilterFn,
  onGlobalFilterChange,
  onRowClick,
  searchPlaceholder,
  selectedRowId,
}: AdminDataTableProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 5,
  })
  const [rowSelection, setRowSelection] = React.useState({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const globalFilterValue = controlledGlobalFilter ?? globalFilter

  function updateGlobalFilter(value: string) {
    setGlobalFilter(value)
    onGlobalFilterChange?.(value)
  }

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) =>
      globalFilterFn ? globalFilterFn(row.original, String(filterValue)) : true,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(globalFilterValue) : updater
      updateGlobalFilter(String(next ?? ""))
    },
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: {
      columnFilters,
      columnVisibility,
      globalFilter: globalFilterValue,
      pagination,
      rowSelection,
      sorting,
    },
  })
  const currentPage = table.getState().pagination.pageIndex + 1
  const pageCount = Math.max(1, table.getPageCount())
  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const totalRows = table.getFilteredRowModel().rows.length
  const isFiltered =
    table.getState().columnFilters.length > 0 || Boolean(table.getState().globalFilter)
  // 「列显示」只在真正有得选的时候出现。
  const hideableColumns = table.getAllColumns().filter((column) => column.getCanHide())
  // 只有一页、行数又不超过最小页容量时，每页选择与翻页按钮都无事可做。
  const paginationUseful = pageCount > 1 || totalRows > MIN_PAGE_SIZE

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            placeholder={searchPlaceholder ?? "搜索"}
            value={table.getState().globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-9 w-full max-w-64"
          />
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId)

            if (!column) return null

            return (
              <Select
                key={filter.columnId}
                value={(column.getFilterValue() as string | undefined) ?? "all"}
                onValueChange={(value) =>
                  column.setFilterValue(value === "all" ? undefined : value)
                }
              >
                <SelectTrigger className="h-9 w-32">
                  <SelectValue placeholder={filter.title} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部{filter.title}</SelectItem>
                  {filter.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          })}
          {isFiltered ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              onClick={() => {
                table.resetColumnFilters()
                table.setGlobalFilter("")
              }}
            >
              重置
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
        {hideableColumns.length >= MIN_HIDEABLE_COLUMNS_FOR_PICKER ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Settings2 className="size-4" />
                列显示
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>显示字段</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hideableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {getColumnLabel(column.columnDef.header, column.id)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={selectedRowId === row.id ? "selected" : undefined}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount > 0
            ? `已选择 ${selectedCount} 条，共 ${totalRows} 条匹配记录`
            : `共 ${totalRows} 条匹配记录`}
        </div>
        {paginationUseful ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">每页</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm font-medium">
            第 {currentPage} / {pageCount} 页
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              aria-label="第一页"
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="上一页"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="下一页"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              aria-label="最后一页"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getColumnLabel(header: unknown, fallback: string) {
  return typeof header === "string" ? header : fallback
}
