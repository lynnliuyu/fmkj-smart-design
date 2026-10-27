"use client"

import * as React from "react"

import { sumMoney } from "@/lib/money"
import type { QuoteImageRefreshResult } from "@/lib/quote-image-refresh"
import { pointIdsRemovedByLines, syncLocalPointDraft } from "@/lib/point-map-quote-removal"
import { pointMapLocalStore } from "@/lib/point-map-local-store"

import { fallbackProducts as catalogFallbackProducts } from "@/lib/fallback-products"
import { addQuoteProductSelection } from "@/lib/quote-point-map-command"
import { consumePointMapQuoteSnapshot, consumeQuoteDraftItems, POINT_MAP_QUOTE_SNAPSHOT_EVENT } from "@/lib/quote-draft"
import { quoteProjects, quoteRooms } from "@/lib/quote-options"
import { addQuoteRoom, deleteQuoteRoom, POINT_SOURCED_ROOM_BLOCKED_MESSAGE, renameQuoteRoom } from "@/lib/quote-room-management"
import {
  groupQuoteItems,
  isProductOption,
  lineTotal,
  mergeQuoteDraftLoad,
  prepareSavedQuoteExport,
  acknowledgeQuotePointChanges,
  pointMapRevisionForQuote,
  quoteItemsSavePayload,
  toProductOption,
  unique,
  type QuoteDatabaseProduct,
  type QuoteGroupMode,
  type QuoteLineItem,
  type QuoteProductOption,
  type QuoteProjectOption,
  type SavedQuoteResponse,
} from "@/lib/quote-authoring"

const fallbackProducts: QuoteProductOption[] = catalogFallbackProducts.map(toProductOption)

type QuoteEditorDraft = {
  projectKey: string
  /** 报价页删除的点位来源，保存时同步从点位设计删除。 */
  pendingPointRemovals: string[]
  /** 报价页修改了点位来源行的房间，保存时同步移动对应点位。 */
  pendingPointRoomMoves: Array<{ pointIds: string[]; room: string }>
  items: QuoteLineItem[]
  rooms: string[]
  installationFee: number
  dirty: boolean
  revision: number
  feeEdited: boolean
  roomsEdited: boolean
  pointMapRevision?: number
  roomChanges: Array<{ from: string; to: string }>
}

function emptyEditorDraft(projectKey: string): QuoteEditorDraft {
  return { projectKey, pendingPointRemovals: [], pendingPointRoomMoves: [], items: [], rooms: [], installationFee: 0, dirty: false, revision: 0, feeEdited: false, roomsEdited: false, roomChanges: [] }
}

export function useQuoteAuthoring({ requestedProjectId }: { requestedProjectId: string | null }) {
  const [databaseProducts, setDatabaseProducts] = React.useState<QuoteProductOption[] | null>(null)
  const [selectedProjectId, setSelectedProjectId] = React.useState(requestedProjectId ?? "")
  const [snapshotSignal, setSnapshotSignal] = React.useState(0)
  const [roomNotice, setRoomNotice] = React.useState("")

  // 点位页保存同步后，报价页立即重新合并快照，无需刷新或重新打开。
  React.useEffect(() => {
    const bump = () => setSnapshotSignal((value) => value + 1)
    window.addEventListener(POINT_MAP_QUOTE_SNAPSHOT_EVENT, bump)
    return () => window.removeEventListener(POINT_MAP_QUOTE_SNAPSHOT_EVENT, bump)
  }, [])
  const [selectedProject, setSelectedProject] = React.useState(quoteProjects[0] ?? "默认项目")
  const [groupMode, setGroupMode] = React.useState<QuoteGroupMode>("room")
  const [status, setStatus] = React.useState("草稿")
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
  const [isUploadingPdf, setIsUploadingPdf] = React.useState(false)
  const [rooms, setRooms] = React.useState<string[]>([])
  const [installationFee, setInstallationFeeValue] = React.useState(0)
  const [items, setItems] = React.useState<QuoteLineItem[]>([])
  const [isLoadingQuote, setIsLoadingQuote] = React.useState(true)
  const [quoteLoadError, setQuoteLoadError] = React.useState("")
  const [quoteSaveError, setQuoteSaveError] = React.useState("")
  const [quoteNo, setQuoteNo] = React.useState("")
  const [isRefreshingImages, setIsRefreshingImages] = React.useState(false)
  const savedQuoteIdentityRef = React.useRef<{ projectId: string; quoteId: string; updatedAt: string } | null>(null)
  const editorRef = React.useRef<QuoteEditorDraft>(emptyEditorDraft(requestedProjectId ?? ""))
  const projectDraftsRef = React.useRef(new Map<string, QuoteEditorDraft>())
  const pendingLoadRef = React.useRef<Promise<void> | null>(null)
  const savingRef = React.useRef(false)
  const savingProjectRef = React.useRef<string | null>(null)
  const projectSelectionRevisionRef = React.useRef(0)

  const quoteProducts = databaseProducts?.length ? databaseProducts : fallbackProducts
  const productCategories = unique(quoteProducts.map((item) => item.category))
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const productsPayableTotal = sumMoney(items.map((item) => lineTotal(item)))
  const payableTotal = productsPayableTotal + installationFee
  const discountTotal = subtotal - productsPayableTotal
  const groups = groupQuoteItems(items, groupMode, productCategories, rooms)

  React.useEffect(() => {
    let active = true

    async function loadProducts() {
      try {
        const response = await fetch("/api/products", { cache: "no-store" })
        const payload = (await response.json()) as { data?: QuoteDatabaseProduct[] }
        const nextProducts = payload.data?.map(toProductOption).filter(isProductOption) ?? []

        if (active && nextProducts.length > 0) {
          setDatabaseProducts(nextProducts)
        }
      } catch {
        if (active) {
          setDatabaseProducts(null)
        }
      }
    }

    void loadProducts()

    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const projectId = requestedProjectId

    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" })
        const payload = (await response.json()) as { data?: QuoteProjectOption[] }
        const nextProjects =
          payload.data
            ?.filter((project) => project.id && project.name)
            .map((project) => ({ id: project.id, name: project.name })) ?? []

        if (!active || nextProjects.length === 0) {
          return
        }

        const matchedProject = projectId ? nextProjects.find((project) => project.id === projectId) : nextProjects[0]

        if (matchedProject) {
          setSelectedProjectId(matchedProject.id)
          setSelectedProject(matchedProject.name)
        }
      } catch {
        // Keep local project options when the database is temporarily unavailable.
      }
    }

    void loadProjects()

    return () => {
      active = false
    }
  }, [requestedProjectId])

  React.useEffect(() => {
    let active = true
    const projectKey = selectedProjectId || selectedProject

    async function loadSavedDraft() {
      if (!projectKey || (!selectedProjectId && requestedProjectId)) return
      setIsLoadingQuote(true)
      setQuoteLoadError("")
      if (editorRef.current.projectKey !== projectKey) {
        const previous = editorRef.current
        if (previous.projectKey) projectDraftsRef.current.set(previous.projectKey, previous)
        const restored = projectDraftsRef.current.get(projectKey) ?? emptyEditorDraft(projectKey)
        editorRef.current = restored
        setItems(restored.items)
        setRooms(restored.rooms)
        setInstallationFeeValue(restored.installationFee)
        setSaveState(restored.dirty ? "idle" : "saved")
      }
      const baseline = editorRef.current
      let savedDraft: SavedQuoteResponse["data"] | undefined

      try {
        if (selectedProjectId) {
          const response = await fetch(`/api/quotes?projectId=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store" })
          if (!response.ok) throw new Error("QUOTE_LOAD_FAILED")
          const payload = (await response.json()) as SavedQuoteResponse
          savedDraft = payload.data ?? null
          if (active && editorRef.current.projectKey === projectKey) {
            savedQuoteIdentityRef.current = savedDraft?.id && savedDraft.updatedAt
              ? { projectId: selectedProjectId, quoteId: savedDraft.id, updatedAt: savedDraft.updatedAt }
              : null
          }
        }
      } catch {
        // A failed cloud read still permits merging this project's local queued work.
        if (active) setQuoteLoadError("报价读取失败，请重新登录或刷新后导出，避免打印不完整报价。")
      }
      if (!active || editorRef.current.projectKey !== projectKey) return

      // Consume only after the cloud read settles so it cannot overwrite imports.
      const draftItems = consumeQuoteDraftItems({ projectId: selectedProjectId || projectKey, projectName: selectedProject })
      const snapshot = selectedProjectId ? consumePointMapQuoteSnapshot(selectedProjectId) : null
      const current = editorRef.current
      const nextItems = mergeQuoteDraftLoad({
        savedItems: savedDraft === undefined ? undefined : savedDraft?.items ?? [],
        localItemsAtStart: baseline.items,
        localItemsNow: current.items,
        preserveLocalDraft: baseline.dirty,
        draftItems,
        pointMapSnapshot: snapshot,
        roomChanges: current.roomChanges,
      })
      // 房间只有一份出处：点位图。点位图的房间永远是第一优先，老报价草稿里存的那份作废
      //（以前保存时会把模板房间和点位图房间并在一起存，那些存量数据是脏的）。
      // 只有点位图完全没有房间时，才退回本机编辑中的/老草稿的/模板。
      const savedRooms = savedDraft?.rooms?.filter(Boolean) ?? []
      const baseRooms = snapshot?.rooms?.length
        ? snapshot.rooms
        : current.roomsEdited && current.rooms.length
          ? current.rooms
          : savedRooms.length
            ? savedRooms
            : quoteRooms
      const nextRooms = unique([...baseRooms, ...nextItems.map((item) => item.room)])
      const fee = baseline.dirty || current.feeEdited || !savedDraft ? current.installationFee : Number(savedDraft.installationFee ?? 0)
      const dirty = current.dirty || draftItems.length > 0 || snapshot !== null
      const next = { ...current, pointMapRevision: snapshot?.revision ?? (baseline.dirty ? current.pointMapRevision : pointMapRevisionForQuote(nextItems)) ?? current.pointMapRevision, items: nextItems, rooms: nextRooms, installationFee: fee, dirty, roomChanges: [] }
      editorRef.current = next
      projectDraftsRef.current.set(projectKey, next)
      setItems(nextItems)
      setQuoteNo(savedDraft?.quoteNo ?? "")
      setRooms(nextRooms)
      setInstallationFeeValue(fee)
      setSaveState(savingRef.current && savingProjectRef.current === projectKey ? "saving" : dirty || !savedDraft ? "idle" : "saved")
      setIsLoadingQuote(false)
    }

    const pending = loadSavedDraft()
    pendingLoadRef.current = pending
    void pending.finally(() => { if (pendingLoadRef.current === pending) pendingLoadRef.current = null })

    return () => {
      active = false
    }
  }, [selectedProjectId, selectedProject, requestedProjectId, snapshotSignal])

  function markEdited(patch: Partial<QuoteEditorDraft> = {}) {
    editorRef.current = { ...editorRef.current, ...patch, dirty: true, revision: editorRef.current.revision + 1 }
    setSaveState("idle")
  }

  function editItems(update: (current: QuoteLineItem[]) => QuoteLineItem[]) {
    const next = update(editorRef.current.items)
    markEdited({ items: next })
    setItems(next)
  }

  async function addProductToQuote(productId: string, room: string) {
    const projectKey = editorRef.current.projectKey
    const selected = quoteProducts.find((option) => option.id === productId) ?? quoteProducts[0]
    try {
      const result = await addQuoteProductSelection({
        product: selected,
        project: {
          id: selectedProjectId,
          name: selectedProject,
        },
        room,
      })
      if (editorRef.current.projectKey !== projectKey) return
      editItems((current) => [...current, result.line])
    } catch (error) {
      if (editorRef.current.projectKey === projectKey) {
        setQuoteSaveError(error instanceof Error ? error.message : "商品加入失败，请重试。")
      }
    }
  }

  function updateItem(lineId: string, patch: Partial<QuoteLineItem>) {
    const line = editorRef.current.items.find((item) => item.lineId === lineId)
    if (line?.pointMapProjectId && patch.room !== undefined && patch.room !== line.room && line.pointIds?.length) {
      markEdited({ pendingPointRoomMoves: [...editorRef.current.pendingPointRoomMoves, { pointIds: line.pointIds, room: patch.room }] })
    }
    // 单价按商品统一：同一产品的所有报价行一起改价；数量、折扣、房间仍按行保存。
    const priceChanged = patch.price !== undefined && line !== undefined
    editItems((current) =>
      current.map((item) => {
        if (item.lineId === lineId) return { ...item, ...patch }
        if (priceChanged && item.id === line.id) return { ...item, price: patch.price! }
        return item
      }),
    )
  }

  function removeItem(lineId: string) {
    const line = editorRef.current.items.find((item) => item.lineId === lineId)
    const removedPoints = pointIdsRemovedByLines(line ? [line] : [])
    if (removedPoints.length) {
      markEdited({ pendingPointRemovals: [...new Set([...editorRef.current.pendingPointRemovals, ...removedPoints])] })
    }
    editItems((current) => current.filter((item) => item.lineId !== lineId))
  }

  function addRoom(roomName: string) {
    const next = addQuoteRoom(editorRef.current.rooms, roomName)
    markEdited({ rooms: next, roomsEdited: true })
    setRooms(next)
  }

  function renameRoom(oldName: string, newName: string) {
    const result = renameQuoteRoom(editorRef.current.rooms, editorRef.current.items, oldName, newName)

    if (result.blocked) { setRoomNotice(POINT_SOURCED_ROOM_BLOCKED_MESSAGE); return }
    setRoomNotice("")
    if (!result.changed) return

    setRooms(result.rooms)
    setItems(result.items)
    markEdited({ rooms: result.rooms, items: result.items, roomsEdited: true, roomChanges: [...editorRef.current.roomChanges, { from: oldName, to: newName.trim() }] })
  }

  function deleteRoom(roomName: string) {
    // 删除区域 = 删除该区域内的点位来源行；对应点位在保存时从点位设计移除。
    const result = deleteQuoteRoom(editorRef.current.rooms, editorRef.current.items, roomName)
    setRoomNotice("")
    setRooms(result.rooms)
    setItems(result.items)
    markEdited({
      rooms: result.rooms,
      items: result.items,
      roomsEdited: true,
      pendingPointRemovals: [...new Set([...editorRef.current.pendingPointRemovals, ...result.removedPointIds])],
      roomChanges: [...editorRef.current.roomChanges, { from: roomName, to: result.rooms[0] }],
    })
  }

  async function saveDraft(): Promise<boolean> {
    return saveDraftWithImages(false)
  }

  async function refreshDraftProductImages(): Promise<boolean> {
    if (savingRef.current || isRefreshingImages) return false
    const identity = savedQuoteIdentityRef.current
    const selectionRevision = projectSelectionRevisionRef.current
    if (!identity || identity.projectId !== selectedProjectId) return false
    setIsRefreshingImages(true)
    try {
      const response = await fetch("/api/quotes/images", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, quoteId: identity.quoteId, expectedUpdatedAt: identity.updatedAt }),
      })
      if (!response.ok) return false
      const { data } = await response.json() as { data: QuoteImageRefreshResult }
      if (editorRef.current.projectKey !== identity.projectId || selectionRevision !== projectSelectionRevisionRef.current) return false
      const byId = new Map(data.products.map((product) => [product.id, product]))
      const nextItems = editorRef.current.items.map((item) => {
        const product = byId.get(item.id)
        return product ? { ...item, image: product.image, productSnapshot: {
          ...item.productSnapshot, image: product.image, visualAsset: product.productSnapshot.visualAsset,
        } } : item
      })
      // Keep all unsaved financial/room edits and their dirty status intact.
      editorRef.current = { ...editorRef.current, items: nextItems, revision: editorRef.current.revision + 1 }
      setItems(nextItems)
      savedQuoteIdentityRef.current = { ...identity, updatedAt: data.updatedAt }
      return true
    } catch { return false } finally { setIsRefreshingImages(false) }
  }

  async function saveDraftWithImages(refreshProductImages: boolean): Promise<boolean> {
    if (savingRef.current) return false
    savingRef.current = true
    const projectKey = selectedProjectId || selectedProject
    const selectionRevision = projectSelectionRevisionRef.current
    savingProjectRef.current = projectKey
    setSaveState("saving")
    setQuoteSaveError("")

    try {
      // Saving before the initial read/import settles would replace existing lines with a partial quote.
      let pending = pendingLoadRef.current
      while (pending) {
        await pending
        if (editorRef.current.projectKey !== projectKey || projectSelectionRevisionRef.current !== selectionRevision) return false
        const latest = pendingLoadRef.current
        if (latest === pending) break
        pending = latest
      }
      if (editorRef.current.projectKey !== projectKey || projectSelectionRevisionRef.current !== selectionRevision) return false
      const editor = editorRef.current
      const savedSubtotal = editor.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const savedProductsTotal = sumMoney(editor.items.map((item) => lineTotal(item)))
      const response = await fetch("/api/quotes", {
        body: JSON.stringify({
          refreshProductImages,
          discount: savedSubtotal - savedProductsTotal,
          installationFee: editor.installationFee,
          items: quoteItemsSavePayload(editor.items),
          projectId: selectedProjectId,
          projectName: selectedProject,
          pointMapRevision: editor.pointMapRevision,
          removedPointIds: editor.pendingPointRemovals,
          pointRoomMoves: editor.pendingPointRoomMoves,
          rooms: editor.rooms,
          subtotal: savedSubtotal,
          total: savedProductsTotal + editor.installationFee,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })

      const result = await response.json() as { error?: string; data?: { id?: string; updatedAt?: string; quoteNo?: string; pointMapRevision?: number } }
      if (!response.ok) throw new Error(result.error || "报价保存失败，请重试。")
      // 云端点位已随报价删除/换房间，本机点位草稿同步改掉，避免点位图再把旧设备写回来。
      await syncLocalPointDraft(pointMapLocalStore(), selectedProjectId, editor.pendingPointRemovals, editor.pendingPointRoomMoves).catch(() => false)

      const stillCurrent = editorRef.current === editor && editorRef.current.projectKey === editor.projectKey && editorRef.current.revision === editor.revision && projectSelectionRevisionRef.current === selectionRevision
      if (editorRef.current.projectKey === projectKey && projectSelectionRevisionRef.current === selectionRevision) {
        editorRef.current = acknowledgeQuotePointChanges(editorRef.current, editor, result.data?.pointMapRevision)
        projectDraftsRef.current.set(projectKey, editorRef.current)
        setItems(editorRef.current.items)
        if (result.data?.quoteNo) setQuoteNo(result.data.quoteNo)
        if (result.data?.id && result.data.updatedAt) savedQuoteIdentityRef.current = { projectId: selectedProjectId, quoteId: result.data.id, updatedAt: result.data.updatedAt }
      }
      if (stillCurrent) {
        editorRef.current = { ...editorRef.current, dirty: false, feeEdited: false, roomsEdited: false }
        projectDraftsRef.current.set(projectKey, editorRef.current)
        setStatus("草稿")
        setSaveState("saved")
      } else if (editorRef.current.projectKey === projectKey && projectSelectionRevisionRef.current === selectionRevision) {
        setSaveState("idle")
      }
      // 保存期间若又有新修改，视为未完成，避免切换页面时丢失这部分修改。
      return stillCurrent
    } catch (error) {
      if (editorRef.current.projectKey === projectKey) {
        setSaveState("error")
        setQuoteSaveError(error instanceof Error ? error.message : "报价保存失败，请重试。")
      }
      return false
    } finally {
      savingRef.current = false
      savingProjectRef.current = null
    }
  }

  async function prepareSavedQuoteForExport() {
    const projectId = selectedProjectId
    const projectName = selectedProject
    const selectionRevision = projectSelectionRevisionRef.current
    if (!projectId) throw new Error("请先选择已保存的项目再导出报价。")
    const result = await prepareSavedQuoteExport({
      saveDraft: () => !editorRef.current.dirty && quoteNo ? Promise.resolve(true) : saveDraft(),
      groupMode,
      captureIsCurrent: () => {
        const savedEditor = editorRef.current
        return () => editorRef.current === savedEditor && savedEditor.projectKey === projectId && projectSelectionRevisionRef.current === selectionRevision
      },
      loadSavedQuote: async () => {
        const response = await fetch(`/api/quotes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
        if (!response.ok) throw new Error(response.status === 401 ? "登录已失效，请重新登录后导出。" : "已保存报价读取失败，请重试。")
        return response.json() as Promise<SavedQuoteResponse>
      },
    })
    setQuoteNo(result.snapshot.quoteNo)
    return { ...result, projectId, projectName }
  }

  function setInstallationFee(value: number) {
    const fee = Math.max(0, Number(value) || 0)
    markEdited({ installationFee: fee, feeEdited: true })
    setInstallationFeeValue(fee)
  }

  async function uploadQuotePdf(file: File | null) {
    if (!file || !selectedProjectId) {
      return
    }

    setIsUploadingPdf(true)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("kind", "quote_pdf")
      formData.append("entityId", selectedProjectId)

      const uploadResponse = await fetch("/api/upload", {
        body: formData,
        method: "POST",
      })
      const uploadPayload = (await uploadResponse.json()) as {
        data?: {
          contentType: string
          fileName: string
          size: number
          url: string
        }
        error?: string
      }

      if (!uploadResponse.ok || !uploadPayload.data) {
        throw new Error(uploadPayload.error ?? "UPLOAD_FAILED")
      }

      const saveResponse = await fetch("/api/attachments", {
        body: JSON.stringify({
          contentType: uploadPayload.data.contentType,
          fileName: uploadPayload.data.fileName,
          fileUrl: uploadPayload.data.url,
          kind: "quote_pdf",
          projectId: selectedProjectId,
          size: uploadPayload.data.size,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const savePayload = (await saveResponse.json()) as { error?: string }

      if (!saveResponse.ok) {
        throw new Error(savePayload.error ?? "ATTACHMENT_SAVE_FAILED")
      }

      setSaveState("saved")
    } finally {
      setIsUploadingPdf(false)
    }
  }

  return {
    actions: {
      addProductToQuote,
      addRoom,
      deleteRoom,
      removeItem,
      renameRoom,
      prepareSavedQuoteForExport,
      refreshDraftProductImages,
      saveDraft,
      setGroupMode,
      setInstallationFee,
      updateItem,
      uploadQuotePdf,
    },
    computed: {
      discountTotal,
      groups,
      payableTotal,
      productCategories,
      quoteProducts,
      subtotal,
    },
    state: {
      groupMode,
      roomNotice,
      hasUnsavedChanges: () => editorRef.current.dirty,
      installationFee,
      isUploadingPdf,
      items,
      isLoadingQuote,
      quoteLoadError,
      quoteSaveError,
      quoteNo,
      isRefreshingImages,
      rooms,
      saveState,
      selectedProject,
      selectedProjectId,
      status,
    },
  }
}
