"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Camera,
  Download,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type SitePhoto = {
  id: string
  projectId: string
  blobUrl: string
  thumbnailUrl: string | null
  blobPathname: string | null
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  category: SitePhotoCategory
  notes: string | null
  takenAt: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

type SitePhotoCategory = "site_entry" | "construction" | "concealed" | "acceptance" | "other"

const CATEGORY_LABELS: Record<SitePhotoCategory, string> = {
  site_entry: "进场",
  construction: "施工",
  concealed: "隐蔽工程",
  acceptance: "验收",
  other: "其他",
}

const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as SitePhotoCategory[]

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"

export function ProjectSitePhotosPanel({ projectId }: { projectId: string }) {
  const [photos, setPhotos] = React.useState<SitePhoto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [uploading, setUploading] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [filterCategory, setFilterCategory] = React.useState<string>("all")
  const [previewPhoto, setPreviewPhoto] = React.useState<SitePhoto | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    void loadPhotos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function loadPhotos() {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/site-photos`)
      const payload = await response.json()
      setPhotos(payload.data ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载现场图片失败")
    } finally {
      setIsLoading(false)
    }
  }

  const visiblePhotos = React.useMemo(
    () =>
      filterCategory === "all"
        ? photos
        : photos.filter((photo) => photo.category === filterCategory),
    [photos, filterCategory],
  )

  async function handleFiles(files: FileList | null, category: SitePhotoCategory) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadProgress(0)

    let completed = 0
    let failed = 0
    for (const file of Array.from(files)) {
      try {
        await uploadOne(file, category, "")
        completed += 1
      } catch (error) {
        failed += 1
        toast.error(`${file.name} 上传失败`, {
          description: error instanceof Error ? error.message : undefined,
        })
      } finally {
        setUploadProgress(Math.round(((completed + failed) / files.length) * 100))
      }
    }

    if (completed > 0) toast.success(`已上传 ${completed} 张现场照片`)
    setUploading(false)
    setUploadProgress(0)
    await loadPhotos()
  }

  async function uploadOne(file: File, category: SitePhotoCategory, notes: string) {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("category", category)
    if (notes) formData.append("notes", notes)

    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/site-photos`, {
      body: formData,
      method: "POST",
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error ?? `上传失败（${response.status}）`)
    }
    return response.json()
  }

  async function handleDelete(photo: SitePhoto) {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/site-photos/${encodeURIComponent(photo.id)}`,
        { method: "DELETE" },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? "删除失败")
      }
      setPhotos((current) => current.filter((item) => item.id !== photo.id))
      if (previewPhoto?.id === photo.id) setPreviewPhoto(null)
      toast.success("已删除")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-lg">现场图片库</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              可随时上传工地实拍，按进场/施工/隐蔽工程/验收分类管理。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="筛选分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {CATEGORY_VALUES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <UploadButton
              uploading={uploading}
              onFiles={(files) => handleFiles(files, inferCategoryFromFilter(filterCategory))}
              onPick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              multiple
              hidden
              onChange={(event) => {
                void handleFiles(event.target.files, inferCategoryFromFilter(filterCategory))
                event.target.value = ""
              }}
            />
          </div>
        </div>
        {uploading ? <Progress value={uploadProgress} className="h-1.5" /> : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            加载中…
          </div>
        ) : visiblePhotos.length === 0 ? (
          <DropArea
            dragOver={dragOver}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              void handleFiles(event.dataTransfer.files, inferCategoryFromFilter(filterCategory))
            }}
            onPick={() => fileInputRef.current?.click()}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visiblePhotos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                onPreview={() => setPreviewPhoto(photo)}
                onDelete={() => void handleDelete(photo)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <PhotoPreviewDialog
        photo={previewPhoto}
        onClose={() => setPreviewPhoto(null)}
        onDelete={(photo) => void handleDelete(photo)}
      />
    </Card>
  )
}

function UploadButton({
  uploading,
  onPick,
  onFiles,
}: {
  uploading: boolean
  onPick: () => void
  onFiles: (files: FileList | null) => void
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.onchange = () => onFiles(inputRef.current?.files ?? null)
    }
  }, [onFiles])

  return (
    <>
      <Button onClick={onPick} disabled={uploading}>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {uploading ? "上传中" : "上传照片"}
      </Button>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} multiple hidden />
    </>
  )
}

function DropArea({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
}: {
  dragOver: boolean
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onPick: () => void
}) {
  return (
    <div
      className={cn(
        "flex min-h-[320px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition",
        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPick}
    >
      <UploadCloud className="size-10 text-muted-foreground" />
      <div>
        <div className="font-medium">点击或拖入照片上传</div>
        <div className="mt-1 text-sm text-muted-foreground">
          支持 JPG / PNG / WebP / GIF，单张不超过 20MB
        </div>
      </div>
    </div>
  )
}

function PhotoTile({
  photo,
  onPreview,
  onDelete,
}: {
  photo: SitePhoto
  onPreview: () => void
  onDelete: () => void
}) {
  return (
    <figure className="group relative overflow-hidden rounded-lg border bg-muted/30">
      <div className="relative aspect-square w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL from object storage */}
        <img
          src={photo.thumbnailUrl ?? photo.blobUrl}
          alt={photo.fileName}
          className="size-full object-cover transition group-hover:scale-105"
          loading="lazy"
          onClick={onPreview}
        />
        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="secondary" className="size-8 shadow-sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onPreview}>
                <Camera className="size-4" />
                查看大图
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={photo.blobUrl} download={photo.fileName}>
                  <Download className="size-4" />
                  下载原图
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="size-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <figcaption className="space-y-1 border-t bg-background/80 p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="font-normal">
            {CATEGORY_LABELS[photo.category]}
          </Badge>
          <span className="text-muted-foreground">{formatTakenAt(photo.takenAt, photo.createdAt)}</span>
        </div>
        <div className="truncate text-muted-foreground" title={photo.fileName}>
          {photo.fileName}
        </div>
        {photo.notes ? (
          <div className="line-clamp-2 text-muted-foreground" title={photo.notes}>
            {photo.notes}
          </div>
        ) : null}
        <div className="text-muted-foreground">上传人：{photo.createdByName ?? "未知"}</div>
      </figcaption>
    </figure>
  )
}

function PhotoPreviewDialog({
  photo,
  onClose,
  onDelete,
}: {
  photo: SitePhoto | null
  onClose: () => void
  onDelete: (photo: SitePhoto) => void
}) {
  return (
    <Dialog open={Boolean(photo)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{photo?.fileName ?? "现场照片"}</DialogTitle>
          {photo ? (
            <DialogDescription>
              {CATEGORY_LABELS[photo.category]} · {formatTakenAt(photo.takenAt, photo.createdAt)} ·
              上传人：{photo.createdByName ?? "未知"}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {photo ? (
          <ScrollArea className="max-h-[60vh]">
            {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL from object storage */}
            <img
              src={photo.blobUrl}
              alt={photo.fileName}
              className="mx-auto max-h-[55vh] w-auto rounded-lg border object-contain"
            />
            {photo.notes ? (
              <div className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                {photo.notes}
              </div>
            ) : (
              <div className="mt-3 text-sm text-muted-foreground">暂无备注</div>
            )}
          </ScrollArea>
        ) : null}

        <DialogFooter className="gap-2">
          {photo ? (
            <a href={photo.blobUrl} download={photo.fileName} className="contents">
              <Button variant="outline">
                <Download className="size-4" />
                下载
              </Button>
            </a>
          ) : null}
          {photo ? (
            <Button variant="destructive" onClick={() => onDelete(photo)}>
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function inferCategoryFromFilter(filter: string): SitePhotoCategory {
  return CATEGORY_VALUES.includes(filter as SitePhotoCategory) ? (filter as SitePhotoCategory) : "other"
}

function formatTakenAt(takenAt: string | null, createdAt: string) {
  const source = takenAt ?? createdAt
  if (!source) return "—"
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", { hour12: false })
}