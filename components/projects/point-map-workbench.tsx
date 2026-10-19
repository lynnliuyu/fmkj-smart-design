"use client";

import { pointMapEditorGeometry, POINT_MAP_EDITOR_SYMBOL_SIZE, POINT_MAP_EDITOR_HIT_SIZE } from "@/lib/point-map-image-size.mjs";
import { focusPointMapEditorView, groupPointMapEditorMarkers, POINT_MAP_MAX_EDITOR_ZOOM } from "@/lib/point-map-editor-view";
import { ProjectViewSwitch } from "@/components/projects/project-view-switch";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  Download,
  FileImage,
  Grip,
  Hand,
  Layers,
  MapPinned,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fallbackProducts as catalogFallbackProducts } from "@/lib/fallback-products";
import {
  findPointIconById,
  pointIconDefinitions,
  pointIconGroups,
  pointIconReplacementGroup,
} from "@/lib/point-icons";
import {
  addPointToPlan,
  applyPointMapPlanPatch,
  emptyPointMapPlan,
  patchPointInPlan,
  placePendingPoint,
  removePointFromPlan,
  summarizePointMapRooms,
  type PointMapNode,
  type PointMapPlan,
  type PointMapStatus,
} from "@/lib/point-map-plan";
import { type QuoteDraftProduct } from "@/lib/quote-draft";
import { pointMapLocalStore } from "@/lib/point-map-local-store";
import { refreshPointMapQuote } from "@/lib/point-map-quote-refresh";
import {
  activePointMapFloor,
  exportPointMapDraft,
  importPointMapDraft,
  isPristinePointMapTemplate,
  normalizeDesignPlan,
  parsePointMapDraft,
  type PointMapDraft,
} from "@/lib/point-map-design";
import {
  nextPointMapPointCode,
  type PointMapFloor,
  type PointMapScene,
} from "@/lib/point-map-plan";
import { releasePointMapPrintFloors, renderPointMapPrintFloors } from "@/lib/point-map-print";
import { buildPointMapProductVisuals, type PointMapVisualQuoteItem } from "@/lib/point-map-product-visuals";
import {
  fetchProjectPointMap,
  PointMapRequestError,
  saveProjectPointMap,
  type PointMapVersion,
} from "./point-map-client";
import {
  applyReviewedPointEdit,
  applyReviewedSceneEdit,
  applyUploadedPointMapFloor,
  fillLoadedPointMapFloorDimensions,
  pointMapSceneConfirmationError,
  samePointMapDesignContent,
} from "./point-map-edits";
import {
  beginPointDrag,
  dragPointPosition,
  pointMapPositionFromPointer,
  pointDragThresholdReached,
  type PointDragState,
} from "@/lib/point-map-interaction";
import { cn } from "@/lib/utils";
import { applyPointMapFloorplanCrop, compactPointMapFloorplan } from "@/lib/point-map-floorplan-crop";
import { PointMapCadPanel } from "./point-map-cad-panel";
import { PointSelectionEditor } from "./point-selection-editor";
import { PointMaterialsEditor } from "./point-materials-editor";
import { PointMapPresentationPanel } from "./point-map-presentation-panel";
import { PointMapDrawings } from "./point-map-drawings";
import { inverseReferenceMatrix, resolveReferenceDrawing, type DrawingView } from "@/lib/point-map-reference-drawings";
import type { PointMapPresentation } from "@/lib/point-map-plan";
import { deviceIntentForIcon, evaluateProductCompatibility } from "@/lib/product-selection";
import { defaultSpacesForPropertyType, type PropertyType } from "@/lib/project-spaces";
import { floorRoomOptions, nextFloorRooms, normalizeRoomName, UNASSIGNED_POINT_ROOM } from "@/lib/point-map-rooms";

const ADD_ROOM_VALUE = "__add_room__";

type Project = {
  id: string;
  name: string;
  customer?: string;
  address?: string;
  propertyType?: PropertyType | null;
};

type Product = QuoteDraftProduct & {
  brand?: string | null;
  tags?: string[];
};

const rooms = [
  "玄关",
  "客厅",
  "餐厅",
  "主卧",
  "次卧",
  "书房",
  "厨房",
  "卫生间",
  "阳台",
  "弱电箱",
];

const statusLabels: Record<PointMapStatus, string> = {
  changed: "需复核",
  confirmed: "已确认",
  pending: "待定位",
  planned: "规划中",
};

const pointMarkerStatusColors: Record<PointMapStatus, string> = {
  confirmed: "#047857",
  planned: "#64748b",
  changed: "#d97706",
  pending: "#94a3b8",
};

const fallbackProjects: Project[] = [];

const fallbackProducts: Product[] = catalogFallbackProducts.map((product) =>
  toQuoteProduct({ ...product, spec: product.description }),
);

export function PointMapWorkbench({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId");
  const [projects, setProjects] = React.useState<Project[]>(fallbackProjects);
  const [products, setProducts] = React.useState<Product[]>(fallbackProducts);
  const [selectedProjectId, setSelectedProjectId] = React.useState(
    initialProjectId || "",
  );
  const [plan, setPlan] = React.useState<PointMapPlan>(() =>
    normalizeDesignPlan(emptyPointMapPlan(initialProjectId || "")),
  );
  const [selectedIconId, setSelectedIconId] = React.useState("switch-1");
  const [selectedRoom, setSelectedRoom] = React.useState(rooms[0]);
  const [selectedProductId, setSelectedProductId] = React.useState("");
  const [activePointId, setActivePointId] = React.useState<string | null>(null);
  const [pointEditorId, setPointEditorId] = React.useState<string | null>(null);
  const [draggingPointId, setDraggingPointId] = React.useState<string | null>(
    null,
  );
  const [draggingIconId, setDraggingIconId] = React.useState<string | null>(
    null,
  );
  const [dragPreview, setDragPreview] = React.useState<{
    pointId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [query, setQuery] = React.useState("");
  const [roomFilter, setRoomFilter] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState(
    "导入助手点位草稿，或上传清晰底图后开始布点。",
  );
  const [tool, setTool] = React.useState<"place" | "pan">("place");
  const [drawingView, setDrawingView] = React.useState<DrawingView>("layout");
  const [referenceState, setReferenceState] = React.useState<{ floorId: string; source: string; view: DrawingView; drawing?: PointMapPresentation; error?: string } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [overlapPointIds, setOverlapPointIds] = React.useState<string[] | null>(null);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = React.useState({
    width: 800,
    height: 600,
  });
  const [naturalSize, setNaturalSize] = React.useState({
    width: 1,
    height: 1,
    source: "",
  });
  const [draftText, setDraftText] = React.useState("");
  const [draftPreview, setDraftPreview] = React.useState<PointMapDraft | null>(
    null,
  );
  const [draftError, setDraftError] = React.useState("");
  const [cloudState, setCloudState] = React.useState<
    "loading" | "ready" | "offline" | "conflict" | "forbidden"
  >(initialProjectId ? "loading" : "offline");
  const [cloudRevision, setCloudRevision] = React.useState<number | null>(null);
  const [cloudPlan, setCloudPlan] = React.useState<PointMapPlan | null>(null);
  const [pointMapSaveError, setPointMapSaveError] = React.useState("");
  const [versions, setVersions] = React.useState<PointMapVersion[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [localStored, setLocalStored] = React.useState(true);
  const [localRestoring, setLocalRestoring] = React.useState(Boolean(initialProjectId));
  const localWriteSequence = React.useRef(0);
  const [hasBackup, setHasBackup] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [viewingVersion, setViewingVersion] = React.useState<number | null>(
    null,
  );
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<PointDragState | null>(null);
  const dragGestureRef = React.useRef<{
    pointId: string;
    start: { clientX: number; clientY: number };
    moved: boolean;
  } | null>(null);
  const suppressPointClickRef = React.useRef<string | null>(null);
  const dragPreviewRef = React.useRef<{
    pointId: string;
    position: { x: number; y: number };
  } | null>(null);
  const panDragRef = React.useRef<{
    x: number;
    y: number;
    origin: { x: number; y: number };
  } | null>(null);
  const liveDraftRef = React.useRef<PointMapPlan | null>(null);
  const localBackupsRef = React.useRef(new Map<string, PointMapPlan>());
  const activeUploadsRef = React.useRef(new Map<string, string>());
  const pendingUploadsRef = React.useRef(0);
  const planRef = React.useRef(plan);
  const projectRef = React.useRef(selectedProjectId);

  const editingDisabled =
    readOnly || viewingVersion !== null || cloudState === "forbidden" || busy || localRestoring;
  const editingDisabledRef = React.useRef(editingDisabled);
  React.useLayoutEffect(() => {
    planRef.current = plan;
    projectRef.current = selectedProjectId;
    editingDisabledRef.current = editingDisabled;
  }, [plan, selectedProjectId, editingDisabled]);
  async function persistLocal(nextPlan: PointMapPlan) {
    const sequence = ++localWriteSequence.current;
    try {
      await pointMapLocalStore().write(nextPlan);
      if (projectRef.current === nextPlan.projectId && sequence === localWriteSequence.current) setLocalStored(true);
      return true;
    } catch (error) {
      if (projectRef.current === nextPlan.projectId && sequence === localWriteSequence.current) {
        setLocalStored(false);
        setMessage(`${errorMessage(error)} 本次修改仍在页面中，请保存到数据库或导出 JSON。`);
      }
      return false;
    }
  }


  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  ) ?? { id: selectedProjectId, name: "未选择项目", propertyType: null };
  const selectedPropertyType = selectedProject.propertyType ?? null;
  const isVilla = selectedPropertyType === "villa";
  const showFloorControls = selectedPropertyType !== "flat" || (plan.floors?.length ?? 0) > 1;
  const selectedIcon =
    findPointIconById(selectedIconId) ?? pointIconDefinitions[0];
  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  );
  const floor = activePointMapFloor(plan);
  const floors = plan.floors ?? [];
  const referenceMatches = referenceState?.floorId === floor?.id && referenceState?.source === floor?.floorplanDataUrl && referenceState?.view === drawingView;
  const activeReference = referenceMatches ? referenceState?.drawing : undefined;
  const referenceError = referenceMatches ? referenceState?.error : undefined;
  React.useEffect(() => {
    let active = true;
    if (drawingView === "layout" || !floor) return;
    void resolveReferenceDrawing(floor, drawingView).then((drawing) => {
      if (active) setReferenceState({ floorId: floor.id, source: floor.floorplanDataUrl, view: drawingView, drawing });
    }).catch((error) => {
      if (active) setReferenceState({ floorId: floor.id, source: floor.floorplanDataUrl, view: drawingView, error: errorMessage(error) });
    });
    return () => { active = false; };
  }, [floor, drawingView]);
  const imageSize =
    naturalSize.source === floor?.floorplanDataUrl
      ? naturalSize
      : floor?.imageWidth && floor.imageHeight
        ? { width: floor.imageWidth, height: floor.imageHeight }
        : { width: 1, height: 1 };
  const editorGeometry = pointMapEditorGeometry(imageSize, viewportSize);
  const floorPoints = React.useMemo(
    () => plan.points.filter((point) => point.floorId === floor?.id),
    [plan.points, floor?.id],
  );
  const floorId = floor?.id;
  const floorRooms = floor?.rooms;
  const availableRooms = floorRoomOptions({ propertyType: selectedPropertyType, floor: floorId === undefined ? undefined : { id: floorId, rooms: floorRooms }, points: plan.points });

  /** 把房间加入当前楼层清单，并一次性指定给点位，避免两次保存互相覆盖。 */
  function addFloorRoom(pointId: string, name: string) {
    const current = planRef.current;
    const activeFloor = activePointMapFloor(current);
    const room = normalizeRoomName(name);
    if (!activeFloor || !room) return null;
    const rooms = nextFloorRooms(
      floorRoomOptions({ propertyType: selectedPropertyType, floor: activeFloor, points: current.points }),
      room,
    );
    const next = applyReviewedPointEdit(current, pointId, { room });
    savePlan({
      ...next,
      floors: next.floors?.map((item) => (item.id === activeFloor.id ? { ...item, rooms } : item)),
    });
    return room;
  }
  const visiblePoints = React.useMemo(() => {
    const value = query.trim().toLowerCase();
    return floorPoints.filter(
      (point) =>
        (!roomFilter || point.room === roomFilter) &&
        (!value ||
        [
          point.code,
          point.name,
          point.room,
          iconForPoint(point).name,
          productName(products, point.productId),
          point.note,
          ...(point.controlTargets ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(value)),
    );
  }, [floorPoints, products, query, roomFilter]);
  const markerGroups = groupPointMapEditorMarkers(
    visiblePoints.filter(point => point.placed).map(point => dragPreview?.pointId === point.id ? { ...point, ...dragPreview.position } : point),
    editorGeometry, zoom, draggingPointId ?? activePointId,
  );
  const individualMarkerIds = new Set(markerGroups.filter(group => group.pointIds.length === 1).flatMap(group => group.pointIds));
  const overlapPoints = visiblePoints.filter(point => overlapPointIds?.includes(point.id));
  const markerTransform = `translate(-50%, -50%) scale(${editorGeometry.markerScale / zoom})`;
  function focusDrawing(points: Array<{ x: number; y: number }>) {
    const camera = focusPointMapEditorView(editorGeometry, points, viewportSize, zoom);
    setZoom(camera.zoom);
    setPan(camera.pan);
  }
  const roomStats = React.useMemo(
    () => summarizePointMapRooms(floorPoints),
    [floorPoints],
  );
  const unresolved = plan.points.filter(
    (point) => point.status !== "confirmed" || !point.placed,
  ).length;
  const proposedScenes = (plan.scenes ?? []).filter(
    (scene) => scene.status !== "confirmed",
  ).length;
  const missingProducts = plan.points.filter(
    (point) =>
      point.productId &&
      !products.some((product) => product.id === point.productId),
  );
  const editorPoint = plan.points.find((point) => point.id === pointEditorId);

  const resetViewport = React.useCallback(() => {
    setZoom(1);
    setOverlapPointIds(null);
    setPan({ x: 0, y: 0 });
    setNaturalSize({ width: 1, height: 1, source: "" });
    setDragPreview(null);
    setDraggingPointId(null);
    dragStateRef.current = null;
    dragGestureRef.current = null;
    suppressPointClickRef.current = null;
    dragPreviewRef.current = null;
    panDragRef.current = null;
    setPointEditorId(null);
  }, []);

  const selectProject = React.useCallback(
    (projectId: string) => {
      if (projectId === projectRef.current) return;
      setSelectedProjectId(projectId);
      const empty = normalizeDesignPlan(emptyPointMapPlan(projectId));
      planRef.current = empty;
      projectRef.current = projectId;
      setPlan(empty);
      setLocalRestoring(Boolean(projectId));
      setActivePointId(null);
      setDrawingView("layout");
      setDraggingPointId(null);
      setDraggingIconId(null);
      setDirty(false);
      setLocalStored(true);
      setDraftPreview(null);
      setDraftError("");
      setHasBackup(localBackupsRef.current.has(projectId));
      setCloudState(projectId ? "loading" : "offline");
      setCloudRevision(null);
      setCloudPlan(null);
      setPointMapSaveError("");
      setVersions([]);
      setViewingVersion(null);
      liveDraftRef.current = null;
      resetViewport();
    },
    [resetViewport],
  );

  React.useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) throw new Error("PROJECTS_UNAVAILABLE");
        const payload = (await response.json()) as { data?: Project[] };
        const nextProjects =
          payload.data?.filter((project) => project.id && project.name) ?? [];
        if (!active) return;
        setProjects(nextProjects);
        const nextProjectId =
          initialProjectId &&
          nextProjects.some((project) => project.id === initialProjectId)
            ? initialProjectId
            : nextProjects[0]?.id || "";
        if (nextProjectId !== projectRef.current) selectProject(nextProjectId);
      } catch {
        if (active)
          setMessage(
            "项目列表暂时不可用。已载入的草稿可在本机继续编辑并导出。",
          );
      }
    }
    async function loadProducts() {
      try {
        const response = await fetch("/api/products", { cache: "no-store" });
        if (!response.ok) throw new Error("PRODUCTS_UNAVAILABLE");
        const payload = (await response.json()) as {
          data?: Array<Product & { description?: string | null; sku?: string }>;
        };
        if (active)
          setProducts(
            payload.data?.map(toQuoteProduct).filter(isProduct) ?? [],
          );
      } catch {
        if (active) {
          setProducts([]);
          setMessage("产品库暂时不可用，产品建议需要恢复连接后重新核对。");
        }
      }
    }
    void loadProjects();
    void loadProducts();
    return () => {
      active = false;
    };
  }, [initialProjectId, selectProject]);

  React.useEffect(() => {
    let active = true;
    if (!selectedProjectId) return;
    async function restoreAndFetch() {
      try {
        const restored = await loadPlan(selectedProjectId);
        const local = restored.plan;
        if (!active) return null;
        setLocalStored(restored.durable);
        if (!hasPlanContent(planRef.current)) {
          planRef.current = local;
          setPlan(local);
        }
        const backup = await readLocalBackup(selectedProjectId);
        if (active && backup) { localBackupsRef.current.set(selectedProjectId, backup); setHasBackup(true); }
      } catch (error) {
        if (active) { setLocalStored(false); setMessage(`${errorMessage(error)} 本机记录保留，请核对数据库草稿。`); }
      } finally { if (active) setLocalRestoring(false); }
      return active ? fetchProjectPointMap(selectedProjectId) : null;
    }
    void restoreAndFetch()
      .then((result) => {
        if (!active || !result) return;
        setCloudRevision(result.revision);
        setVersions(result.versions);
        setCloudPlan(result.data ? normalizeDesignPlan(result.data) : null);
        setCloudState("ready");
        const local = planRef.current;
        if (
          !result.data &&
          selectedPropertyType &&
          !hasPlanContent(local) &&
          pendingUploadsRef.current === 0
        ) {
          const next = seedPlanForPropertyType(local, selectedPropertyType)
          setPlan(next)
          void persistLocal(next)
          setDirty(true)
          setMessage(isVilla ? "已按别墅户型预置楼层和房间，可继续上传各层底图。" : "已按平层户型预置全屋房间，可继续上传底图。")
        } else if (
          result.data &&
          !hasPlanContent(local) &&
          pendingUploadsRef.current === 0
        ) {
          const next = normalizeDesignPlan(result.data);
          setPlan(next);
          resetViewport();
          persistLocal(next);
          setDirty(false);
          setMessage(`已载入云端草稿 r${result.revision}。`);
        } else {
          const differs =
            (hasPlanContent(local) || pendingUploadsRef.current > 0) &&
            !samePlanContent(local, result.data);
          setDirty(differs);
          if (
            differs &&
            result.data &&
            !samePointMapDesignContent(local, result.data)
          ) {
            setCloudState("conflict");
            setMessage(
              "本机草稿与云端内容不同。请先导出本机 JSON，再加载云端草稿比较，避免覆盖他人的修改。",
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setHasBackup(localBackupsRef.current.has(selectedProjectId));
        setCloudState(
          error instanceof PointMapRequestError &&
            [401, 403].includes(error.status)
            ? "forbidden"
            : "offline",
        );
        setMessage(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [selectedProjectId, selectedPropertyType, isVilla, resetViewport]);

  React.useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = () =>
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);


  function savePlan(nextPlan: PointMapPlan) {
    if (editingDisabledRef.current) return;
    const next = normalizeDesignPlan(nextPlan);
    planRef.current = next;
    setPlan(next);
    setDirty(true);
    void persistLocal(next);
  }

  function updatePlan(patch: Partial<PointMapPlan>) {
    savePlan(applyPointMapPlanPatch(planRef.current, patch));
  }

  function selectFloor(floorId: string) {
    const next = normalizeDesignPlan({ ...plan, activeFloorId: floorId });
    setPlan(next);
    if (viewingVersion === null) persistLocal(next);
    setActivePointId(null);
    setDrawingView("layout");
    setQuery("");
    setRoomFilter(null);
    resetViewport();
  }

  function selectIcon(iconId: string) {
    const icon = findPointIconById(iconId) ?? pointIconDefinitions[0];
    setSelectedIconId(icon.id);
    setSelectedProductId("");
    setTool("place");
  }

  function addFloor() {
    const nextFloor: PointMapFloor = {
      id: crypto.randomUUID(),
      name: `${floors.length + 1} 层`,
      floorplanName: "",
      floorplanDataUrl: "",
      imageWidth: 0,
      imageHeight: 0,
    };
    updatePlan({ floors: [...floors, nextFloor], activeFloorId: nextFloor.id });
    resetViewport();
    setMessage("楼层已创建，请为当前楼层上传底图。");
  }

  function patchFloor(patch: Partial<PointMapFloor>) {
    if (!floor) return;
    updatePlan({
      floors: floors.map((item) =>
        item.id === floor.id ? { ...item, ...patch, id: item.id } : item,
      ),
    });
  }

  function recordLoadedFloorplanImage(
    floorId: string,
    image: HTMLImageElement,
  ) {
    const measured = {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image.getAttribute("src") ?? "",
    };
    const current = planRef.current;
    const currentFloor = activePointMapFloor(current);
    if (
      currentFloor?.id !== floorId ||
      currentFloor.floorplanDataUrl !== measured.source
    )
      return;
    setNaturalSize(measured);
    if (editingDisabledRef.current) return;
    const next = fillLoadedPointMapFloorDimensions(
      current,
      floorId,
      measured.source,
      measured,
    );
    if (next !== current) {
      planRef.current = next;
      savePlan(next);
    }
  }

  async function uploadFloorplan(file: File | null) {
    if (editingDisabled || !file || !floor) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage(
        "请选择 PNG、JPG 或 WebP 图片。DWG 先用 CADCraft 导出原图逐页对照，确认方案后再提取对应净底。",
      );
      return;
    }
    const targetProject = selectedProjectId;
    const targetFloor = floor.id;
    const uploadKey = JSON.stringify([targetProject, targetFloor]);
    const uploadId = crypto.randomUUID();
    activeUploadsRef.current.set(uploadKey, uploadId);
    pendingUploadsRef.current += 1;
    setUploading(true);
    setMessage(`正在读取 ${file.name}，读取完成后再保存或同步报价。`);
    try {
      const dataUrl = await readFileDataUrl(file);
      const image = await loadImage(dataUrl);
      if (
        projectRef.current !== targetProject ||
        editingDisabledRef.current ||
        activeUploadsRef.current.get(uploadKey) !== uploadId
      )
        return;
      const currentPlan = planRef.current;
      const result = applyUploadedPointMapFloor(currentPlan, targetFloor, {
        dataUrl,
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      savePlan(result.plan);
      setDrawingView("layout");
      if (currentPlan.activeFloorId === targetFloor) resetViewport();
      setMessage(
        result.replaced && result.affectedPoints
          ? `${file.name} 已替换底图，${result.affectedPoints} 个点位已改为需复核，关联场景改为待确认。请核对点位位置、房间与控制灯组。`
          : `${file.name} 已载入。请核对当前楼层图纸，坐标以图片实际范围为准。`,
      );
    } catch (error) {
      if (
        projectRef.current === targetProject &&
        activeUploadsRef.current.get(uploadKey) === uploadId
      )
        setMessage(`${errorMessage(error)} 原底图与点位仍然保留。`);
    } finally {
      pendingUploadsRef.current -= 1;
      if (pendingUploadsRef.current === 0) setUploading(false);
    }
  }

  async function compactFloorplan() {
    if (editingDisabled || uploading || !floor?.floorplanDataUrl) return;
    const before = planRef.current;
    const targetFloor = floor.id;
    const source = floor.floorplanDataUrl;
    pendingUploadsRef.current += 1;
    setUploading(true);
    setMessage("正在整理外围留白，并同步点位与 CAD 坐标…");
    try {
      const result = await compactPointMapFloorplan(source);
      if (result.sourceSize.width !== floor.imageWidth || result.sourceSize.height !== floor.imageHeight)
        throw new Error("图片实际尺寸与底图记录不符，请先核对底图。");
      if (result.crop.width === floor.imageWidth && result.crop.height === floor.imageHeight) {
        if (planRef.current === before) setMessage("外围已没有可裁去的多余留白，底图与点位保持原样。");
        return;
      }
      const next = await applyPointMapFloorplanCrop(before, targetFloor, source, result.crop, result.image);
      if (planRef.current !== before || projectRef.current !== before.projectId || editingDisabledRef.current)
        throw new Error("整理期间草稿已变化，请在当前草稿上重试。");
      localBackupsRef.current.set(before.projectId, before);
      setHasBackup(true);
      let backupStored = false;
      try {
        await pointMapLocalStore().write(before, true);
        backupStored = true;
      } catch { /* In-memory backup remains exportable until this page closes. */ }
      savePlan(next);
      resetViewport();
      const removed = Math.round((1 - result.crop.width * result.crop.height / (floor.imageWidth * floor.imageHeight)) * 100);
      setMessage(`已裁去约 ${removed}% 外围空纸，保留 3% 安全边距。点位、CAD 与风格校准已同步；${backupStored ? "原稿可通过“导出本机备份”取回。" : "原稿备份仅在当前页面有效，请在关闭前点击“导出本机备份”下载。"}当前仅本机草稿，请保存到数据库。`);
    } catch (error) {
      if (projectRef.current === before.projectId) setMessage(`${errorMessage(error)} 未应用本次裁切。`);
    } finally {
      pendingUploadsRef.current -= 1;
      if (!pendingUploadsRef.current) setUploading(false);
    }
  }

  function addPoint(event: React.PointerEvent<HTMLDivElement>) {
    if (
      editingDisabled ||
      tool !== "place" ||
      !floor?.floorplanDataUrl ||
      (drawingView !== "layout" && !activeReference) ||
      event.button !== 0
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("[data-point-node]")
    )
      return;
    event.stopPropagation();
    createPointAt(pointFromEvent(event, canvasRef.current));
  }

  function dropIcon(event: React.DragEvent<HTMLDivElement>) {
    if (drawingView !== "layout" && !activeReference) return;
    if (editingDisabled || !floor?.floorplanDataUrl) return;
    event.preventDefault();
    event.stopPropagation();
    const iconId =
      event.dataTransfer.getData("application/x-point-icon") || draggingIconId;
    if (!iconId || !findPointIconById(iconId)) return;
    selectIcon(iconId);
    createPointAt(pointFromEvent(event, canvasRef.current), iconId);
    setDraggingIconId(null);
  }

  function createPointAt(
    position: { x: number; y: number },
    iconId = selectedIcon.id,
  ) {
    const current = planRef.current;
    const pendingPoint = current.points.find(
      (point) =>
        point.id === activePointId &&
        !point.placed &&
        point.floorId === floor?.id,
    );
    if (pendingPoint) {
      savePlan(placePendingPoint(current, pendingPoint.id, position));
      setMessage(`${pendingPoint.name} 已确定位置，请复核控制关系。`);
      return;
    }
    const intent = deviceIntentForIcon(iconId);
    const explicitProduct = selectedProduct && intent && evaluateProductCompatibility(intent, selectedProduct).status === "compatible"
      ? selectedProduct
      : undefined;
    const result = addPointToPlan(current, {
      iconId,
      position,
      productId: explicitProduct?.id,
      room: selectedRoom.trim() || "未分配",
    });
    savePlan(
      patchPointInPlan(result.plan, result.point.id, {
        floorId: floor?.id,
        source: "manual",
        usage: explicitProduct ? "selected" : "proposed",
        code: nextPointMapPointCode(current.points),
      }),
    );
    setActivePointId(result.point.id);
    setMessage(
      `${result.point.name} 已添加。可拖动点位，或在详情中输入精确坐标。`,
    );
  }

  function beginDrag(
    pointId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (editingDisabled || tool === "pan" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setActivePointId(pointId);
    setDraggingPointId(pointId);
    suppressPointClickRef.current = null;
    dragGestureRef.current = {
      pointId,
      start: { clientX: event.clientX, clientY: event.clientY },
      moved: false,
    };
    const point = plan.points.find((item) => item.id === pointId);
    dragStateRef.current = point
      ? beginPointDrag({
          pointId,
          pointPosition: point,
          pointerPosition: pointFromEvent(event, canvasRef.current),
        })
      : null;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function previewPointMove(
    pointId: string,
    event: React.PointerEvent<HTMLElement>,
  ) {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointId !== pointId) return;
    if (!gesture.moved) {
      if (!pointDragThresholdReached(gesture.start, event)) return;
      gesture.moved = true;
    }
    const preview = {
      pointId,
      position: dragPointPosition(
        dragStateRef.current,
        pointFromEvent(event, canvasRef.current),
      ),
    };
    dragPreviewRef.current = preview;
    setDragPreview(preview);
  }

  function endDrag(
    pointId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointId !== pointId) return;
    event.stopPropagation();
    const moved = gesture.moved || pointDragThresholdReached(gesture.start, event);
    const cancelled = event.type === "pointercancel";
    if (moved && !cancelled)
      patchPoint(
        pointId,
        dragPointPosition(
          dragStateRef.current,
          pointFromEvent(event, canvasRef.current),
        ),
      );
    suppressPointClickRef.current = moved || cancelled ? pointId : null;
    setDraggingPointId(null);
    setDragPreview(null);
    dragStateRef.current = null;
    dragGestureRef.current = null;
    dragPreviewRef.current = null;
    if (cancelled) setMessage("已取消拖动，原点位位置保留。");
    else if (moved) setMessage("点位位置已更新，请保存草稿写入数据库。");
  }

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "pan" || event.button !== 0 || draggingPointId) return;
    panDragRef.current = { x: event.clientX, y: event.clientY, origin: pan };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function patchPoint(pointId: string, patch: Partial<PointMapNode>) {
    const current = planRef.current;
    const next = applyReviewedPointEdit(current, pointId, patch);
    if (next !== current) savePlan(next);
  }

  function removePoint(pointId: string) {
    savePlan(removePointFromPlan(planRef.current, pointId));
    if (activePointId === pointId) setActivePointId(null);
  }

  function previewDraft() {
    try {
      const parsed = parsePointMapDraft(JSON.parse(draftText));
      setDraftPreview(parsed);
      setDraftError("");
    } catch (error) {
      setDraftPreview(null);
      setDraftError(
        error instanceof SyntaxError
          ? "JSON 格式错误，请粘贴完整的草稿文件内容。"
          : errorMessage(error),
      );
    }
  }

  function applyDraft() {
    if (!draftPreview || editingDisabled) return;
    try {
      const result = importPointMapDraft(planRef.current, draftPreview);
      savePlan(result.plan);
      resetViewport();
      setDraftPreview(null);
      setMessage(
        `已预摆 ${result.added} 个点位，保留 ${result.skipped} 个同 ID 的已有点位。助手建议仍需逐项复核。`,
      );
    } catch (error) {
      setDraftError(errorMessage(error));
    }
  }

  async function importDraftFile(file: File | null) {
    if (!file) return;
    const targetProject = selectedProjectId;
    try {
      const text = await file.text();
      const parsed = parsePointMapDraft(JSON.parse(text));
      if (projectRef.current !== targetProject || editingDisabledRef.current)
        return;
      setDraftText(text);
      setDraftPreview(parsed);
      setDraftError("");
    } catch (error) {
      if (projectRef.current !== targetProject || editingDisabledRef.current)
        return;
      setDraftPreview(null);
      setDraftError(
        error instanceof SyntaxError
          ? "JSON 文件格式错误，尚未改动当前点位。"
          : errorMessage(error),
      );
    }
  }

  function exportJson() {
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再导出草稿。");
      return;
    }
    try {
      downloadJson(
        exportPointMapDraft(plan),
        `${selectedProject.name}-${viewingVersion ? `确认版-r${viewingVersion}` : "设计草稿"}.json`,
      );
      setMessage(
        "已导出结构化 JSON，包含所有楼层、点位、控制关系和场景，可交回助手继续分析。",
      );
    } catch (error) {
      setMessage(`请先完善草稿再导出：${errorMessage(error)}`);
    }
  }

  async function exportLocalBackup() {
    try {
      const backup =
        localBackupsRef.current.get(selectedProjectId) ??
        await readLocalBackup(selectedProjectId);
      if (!backup) throw new Error("没有可读取的本机备份。");
      downloadJson(
        exportPointMapDraft(backup),
        `${selectedProject.name}-本机备份.json`,
      );
      setMessage(
        "已导出加载云端前的本机草稿备份，可交给助手比较修改。当前草稿没有改变。",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function saveCloud(confirm = false): Promise<boolean> {
    setPointMapSaveError("");
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再保存。");
      setPointMapSaveError("底图正在读取，请完成后再保存。");
      return false;
    }
    if (editingDisabled || !selectedProjectId || cloudRevision === null) return false;
    // 切换页面时的「保存」也走这里：本机草稿与云端冲突时不能覆盖云端，
    // 否则报价页刚删掉的设备会被旧草稿写回。
    if (cloudState === "conflict") {
      const conflict = "本机草稿与云端不一致，未保存。请先点「加载云端草稿」核对后再修改。";
      setMessage(conflict);
      setPointMapSaveError(conflict);
      return false;
    }
    if (
      confirm &&
      (plan.scenes ?? []).some((scene) =>
        pointMapSceneConfirmationError(scene, plan.points),
      )
    ) {
      setMessage(
        "场景信息尚未完整。每个场景都需要名称、触发方式、动作与条件和至少一个关联点位，请补充后再确认版本。",
      );
      return false;
    }
    if (confirm && (unresolved || proposedScenes || missingProducts.length)) {
      setMessage(
        `尚有 ${unresolved} 个点位未完成定位/确认、${proposedScenes} 个场景待确认、${missingProducts.length} 个产品未匹配。请逐项复核后确认版本。`,
      );
      return false;
    }
    const current = planRef.current;
    const currentFloor = activePointMapFloor(current);
    const snapshot = currentFloor
      ? fillLoadedPointMapFloorDimensions(
          current,
          currentFloor.id,
          naturalSize.source,
          naturalSize,
        )
      : current;
    if (snapshot !== current) {
      planRef.current = snapshot;
      savePlan(snapshot);
    }
    const projectId = selectedProjectId;
    setBusy(true);
    try {
      const result = await saveProjectPointMap(
        snapshot,
        cloudRevision,
        confirm,
      );
      if (projectRef.current !== projectId) return false;
      setCloudRevision(result.revision);
      setVersions(result.versions);
      setCloudPlan(result.data ? normalizeDesignPlan(result.data) : snapshot);
      setDirty(false);
      setCloudState("ready");
      setMessage(
        confirm
          ? `已保存确认版本 r${result.revision}，后续修改不会改动这个版本。`
          : `云端草稿 r${result.revision} 已保存。`,
      );
      // 等待报价快照写入完成，切换到报价页时才能读到最新结果。
      // Saving also retries a previously blocked/failed quote sync, even without design edits.
      await autoSyncQuote(result.revision, projectId);
      return true;
    } catch (error) {
      if (projectRef.current !== projectId) return false;
      setPointMapSaveError(errorMessage(error));
      setCloudState(
        error instanceof PointMapRequestError && error.status === 409
          ? "conflict"
          : error instanceof PointMapRequestError &&
              [401, 403].includes(error.status)
            ? "forbidden"
            : error instanceof PointMapRequestError &&
                [400, 413, 415, 422].includes(error.status)
              ? "ready"
              : "offline",
      );
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadCloud() {
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再加载云端草稿。");
      return;
    }
    if (!selectedProjectId || busy) return;
    setBusy(true);
    const projectId = selectedProjectId;
    try {
      const result = await fetchProjectPointMap(projectId);
      if (projectRef.current !== projectId) return;
      setCloudRevision(result.revision);
      setVersions(result.versions);
      setCloudPlan(result.data ? normalizeDesignPlan(result.data) : null);
      setCloudState("ready");
      if (result.data) {
        // Keep a recoverable local backup before the user's explicit cloud replacement.
        const backup = liveDraftRef.current ?? planRef.current;
        localBackupsRef.current.set(projectId, backup);
        setHasBackup(true);
        let backupStored = false;
        try {
          await pointMapLocalStore().write(backup, true);
          backupStored = true;
        } catch {
          /* JSON export is also available. */
        }
        const next = normalizeDesignPlan(result.data);
        setPlan(next);
        resetViewport();
        persistLocal(next);
        setViewingVersion(null);
        liveDraftRef.current = null;
        setActivePointId(null);
        setDirty(false);
        setMessage(
          backupStored
            ? `已载入云端草稿 r${result.revision}。原本机草稿已保留备份。`
            : `已载入云端草稿 r${result.revision}。原草稿暂存于当前页面，请导出本机备份后再关闭页面。`,
        );
      } else setMessage("云端还没有点位图。本机草稿仍然保留，可点击保存草稿。");
    } catch (error) {
      if (projectRef.current === projectId) {
        setCloudState(
          error instanceof PointMapRequestError &&
            [401, 403].includes(error.status)
            ? "forbidden"
            : "offline",
        );
        setMessage(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function viewVersion(value: string) {
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再切换版本。");
      return;
    }
    if (value === "draft") {
      if (liveDraftRef.current) setPlan(liveDraftRef.current);
      resetViewport();
      liveDraftRef.current = null;
      setViewingVersion(null);
      setActivePointId(null);
      setMessage("已回到可编辑草稿。");
      return;
    }
    const revision = Number(value);
    const projectId = selectedProjectId;
    setBusy(true);
    try {
      const result = await fetchProjectPointMap(projectId, revision);
      if (projectRef.current !== projectId || !result.data) return;
      if (viewingVersion === null) liveDraftRef.current = planRef.current;
      setPlan(normalizeDesignPlan(result.data));
      resetViewport();
      setViewingVersion(revision);
      setActivePointId(null);
      setMessage(`正在查看确认版本 r${revision}。此版本只读，可以导出。`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportPng() {
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再导出图纸。");
      return;
    }
    if (!floor?.floorplanDataUrl) return;
    try {
      const quoteMapping = await loadQuotePointProductMapping(selectedProjectId, plan, floor.id, products);
      const images = await renderPointMapPrintFloors(plan, quoteMapping.items, products, { floorIds: [floor.id], cacheNamespace: `project:${selectedProjectId}` });
      const image = images[0];
      if (!image) throw new Error("当前楼层没有可导出的图纸。");
      const link = document.createElement("a");
      link.download = `${selectedProject.name}-${floor.name}-草稿检查-点位图.png`;
      link.href = image.src;
      link.click();
      setTimeout(() => releasePointMapPrintFloors(images), 1000);
      setMessage(`已导出${floor.name}草稿检查图：${quoteMapping.photoCount} 个商品圆图，${quoteMapping.iconCount} 个分类圆图${image.reused ? "，已复用未变化的图纸" : ""}。客户交付请使用固定 V 版本。`);
    } catch (error) {
      setMessage(`导出失败：${errorMessage(error)}`);
    }
  }

  async function loadQuotePointProductMapping(projectId: string, currentPlan: PointMapPlan, floorId: string, catalog: Product[]) {
    const response = await fetch(`/api/quotes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "登录已失效，请重新登录后导出。" : "无法读取报价商品对应关系，请重试。");
    const payload = await response.json() as { data?: { items?: Array<PointMapVisualQuoteItem & { pointMapRevision?: number }> } | null };
    const items = payload.data?.items ?? [];
    const visual = buildPointMapProductVisuals(currentPlan, floorId, items, catalog);
    const floorPoints = currentPlan.points.filter((point) => point.floorId === floorId && point.placed);
    return {
      ...visual,
      items,
      photoCount: visual.productIdByPointId.size,
      iconCount: floorPoints.length - visual.productIdByPointId.size,
    };
  }

  /** 点位云端保存成功后自动刷新报价快照；阻塞时保留原报价并提示原因。 */
  async function autoSyncQuote(revision: number, projectId: string) {
    const result = await refreshPointMapQuote(projectId, selectedProject.name, {
      expectedRevision: revision,
      isCurrent: () => projectRef.current === projectId,
    });
    if (projectRef.current !== projectId) return;
    setMessage(result.updated
      ? `点位草稿 r${revision} 已保存。已更新本机报价预览：${result.included} 台设备，${result.unverified} 个点位按未核验型号报价，${result.excluded} 个点位未计入。进入报价页核对并保存数据库报价；未核验报价不代表已完成采购核验。`
      : `点位草稿 r${revision} 已保存。报价预览未更新：${result.message} 原报价保持。`);
  }

  const cloudLabel =
    viewingVersion !== null
      ? `确认版本 r${viewingVersion} · 只读`
      : cloudState === "loading"
        ? "正在连接云端"
        : cloudState === "offline"
          ? "离线 · 仅本机草稿"
          : cloudState === "conflict"
            ? "云端冲突 · 本机修改保留"
            : cloudState === "forbidden"
              ? "当前只读 · 无编辑权限"
              : dirty
                ? "本机有修改 · 尚未保存云端"
                : cloudRevision
                  ? `云端已保存 r${cloudRevision}`
                  : "仅本机草稿 · 云端尚未保存";

  const editorSaveStatus = busy
    ? "正在保存到数据库…"
    : cloudState === "loading"
      ? "正在读取数据库…"
      : pointMapSaveError
        ? `保存失败：${pointMapSaveError}`
        : viewingVersion !== null || readOnly || cloudState === "forbidden"
          ? "当前只读，无法保存修改。"
          : cloudState === "conflict"
            ? "数据库版本冲突，请加载最新草稿后再保存。"
            : cloudState === "offline"
              ? "数据库暂不可用，修改仍在当前页面中。"
              : dirty
                ? "有修改待保存"
                : cloudRevision
                  ? `数据库已保存 r${cloudRevision}`
                  : "尚未保存到数据库";

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">点位图工作台</h1>
          <p className="text-sm text-muted-foreground">
            导入助手分析草稿，按楼层微调点位、控制灯组和场景，再保存草稿、核对报价并生成客户方案。
          </p>
        </div>
        {selectedProjectId ? <ProjectViewSwitch
          active="point-map"
          projectId={selectedProjectId}
          hasUnsavedChanges={() => dirty}
          onSave={() => saveCloud(false)}
        /> : null}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Badge
            variant={
              cloudState === "conflict" || cloudState === "forbidden"
                ? "destructive"
                : "secondary"
            }
          >
            {cloudLabel}
          </Badge>
          {readOnly && <Badge variant="outline">订阅或项目权限只读</Badge>}
          {!localStored && (
            <Badge variant={!dirty && cloudRevision ? "secondary" : "destructive"}>{!dirty && cloudRevision ? "本机缓存不可用 · 已保存数据库" : "本机缓存不可用 · 请保存云端或导出"}</Badge>
          )}
          <span className="mr-auto text-xs text-muted-foreground">
            {localStored ? "编辑自动保存在本机；云端保存需点击按钮。" : "本机缓存不可用，修改后请及时保存到云端。"}
            {cloudPlan
              ? ` 云端 r${cloudRevision} 共 ${cloudPlan.points.length} 个点位。`
              : ""}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveCloud()}
            disabled={
              editingDisabled ||
              uploading ||
              !selectedProjectId ||
              cloudRevision === null ||
              cloudState === "conflict"
            }
          >
            <Save className="size-4" />
            保存草稿
          </Button>

        </CardContent>
      </Card>

      <details className="rounded-xl border bg-card p-3" open={!hasPlanContent(plan) || cloudState === "conflict"}>
        <summary className="cursor-pointer text-sm font-medium">高级工具 · 助手导入、CAD、底图与版本恢复</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">草稿 PNG 使用当前编辑位置与已保存报价，仅用于检查。客户 PNG 与 PDF 请从“客户交付”生成固定版本后导出。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportJson} disabled={uploading || (!plan.points.length && !hasPlanContent(plan))}><Download className="size-4" />导出草稿 JSON</Button>
            <Button size="sm" variant="outline" onClick={exportPng} disabled={uploading || !floor?.floorplanDataUrl}><Download className="size-4" />草稿检查 PNG</Button>
            <Button size="sm" variant="outline" onClick={compactFloorplan} disabled={editingDisabled || uploading || !floor?.floorplanDataUrl}>整理底图留白</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadCloud}
            disabled={busy || uploading || !selectedProjectId}
          >
            加载云端草稿
          </Button>
          {hasBackup && (
            <Button size="sm" variant="outline" onClick={exportLocalBackup}>
              导出本机备份
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => saveCloud(true)}
            disabled={
              editingDisabled ||
              uploading ||
              !selectedProjectId ||
              cloudRevision === null ||
              cloudState === "conflict" ||
              !plan.points.length
            }
          >
            确认设计版本
          </Button>
          {versions.length > 0 && (
            <Select
              value={viewingVersion === null ? "draft" : String(viewingVersion)}
              onValueChange={viewVersion}
              disabled={busy || uploading}
            >
              <SelectTrigger aria-label="查看保存版本" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">当前编辑草稿</SelectItem>
                {versions.map((version) => (
                  <SelectItem
                    key={version.revision}
                    value={String(version.revision)}
                  >
                    确认版 r{version.revision}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          </div>
      <PointMapPresentationPanel
        plan={plan}
        saved={cloudRevision !== null && !dirty}
        disabled={editingDisabled || uploading}
        onApply={(next, expected) => {
          if (planRef.current !== expected || next.projectId !== projectRef.current || editingDisabledRef.current || pendingUploadsRef.current > 0) return false;
          savePlan(next);
          planRef.current = normalizeDesignPlan(next);
          return true;
        }}
      />

      <details className="rounded-xl border bg-card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          导入助手点位草稿
        </summary>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="point-map-draft">点位 JSON</Label>
            <Textarea
              id="point-map-draft"
              className="field-sizing-fixed min-h-32 min-w-0 max-w-full font-mono text-xs"
              value={draftText}
              disabled={editingDisabled}
              onChange={(event) => {
                setDraftText(event.target.value);
                setDraftPreview(null);
                setDraftError("");
              }}
              placeholder="粘贴助手提供的 fmkj-point-map-draft JSON，先校验预览，再确认预摆。"
            />
            <div className="flex flex-wrap gap-2">
              <JsonDraftUpload
                disabled={editingDisabled}
                onUpload={importDraftFile}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={previewDraft}
                disabled={editingDisabled || !draftText.trim()}
              >
                校验并预览
              </Button>
            </div>
            {draftError && (
              <p role="alert" className="text-sm text-destructive">
                {draftError}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            {draftPreview ? (
              <div className="space-y-2">
                <p className="font-medium">校验通过，当前图纸尚未改动</p>
                <p>
                  {draftPreview.floors.length} 个楼层 ·{" "}
                  {draftPreview.points.length} 个点位 ·{" "}
                  {draftPreview.scenes.length} 个场景
                </p>
                <p className="text-xs text-muted-foreground">
                  {draftPreview.floors.map((item) => item.name).join("、")}
                  。相同 ID 保留已有微调；新导入点位和场景需要复核。
                </p>
                {draftPreview.points.some(
                  (point) =>
                    point.productId &&
                    !products.some((product) => product.id === point.productId),
                ) && (
                  <p className="text-xs text-destructive">
                    有产品建议未匹配当前产品库，导入后请重新选型。
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={applyDraft}
                  disabled={editingDisabled}
                >
                  确认预摆点位
                </Button>
              </div>
            ) : (
              <p className="text-xs leading-6 text-muted-foreground">
                在助手聊天中分析清晰平面图、开关图，取得点位草稿后导入。
                楼层底图可以在导入后逐层上传。
              </p>
            )}
          </div>
        </div>
      </details>

      <PointMapCadPanel
        key={`${selectedProjectId}:${floor?.id ?? ""}:${viewingVersion ?? "draft"}`}
        plan={plan}
        floor={floor}
        projectName={selectedProject.name}
        editingDisabled={editingDisabled}
        uploading={uploading}
        getCurrentContext={() => ({
          plan: planRef.current,
          projectId: projectRef.current,
          floorId: activePointMapFloor(planRef.current)?.id,
          editingDisabled: editingDisabledRef.current,
          uploading: pendingUploadsRef.current > 0,
        })}
        onApply={(next, expected) => {
          if (
            planRef.current !== expected ||
            next.projectId !== projectRef.current ||
            editingDisabledRef.current ||
            pendingUploadsRef.current > 0
          )
            return false;
          savePlan(next);
          planRef.current = normalizeDesignPlan(next);
          return true;
        }}
      />
        </div>
      </details>

      <Card className="overflow-hidden">
        <CardHeader className="gap-3 p-3 md:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPinned className="size-4" />
                图纸标点
              </CardTitle>
              <CardDescription
                className="mt-1 text-xs"
                role="status"
                aria-live="polite"
              >
                {message}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ProjectSelect
                disabled={busy || uploading}
                projects={projects}
                value={selectedProjectId}
                onChange={selectProject}
              />
              <FloorplanUpload
                disabled={editingDisabled || uploading}
                onUpload={uploadFloorplan}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showFloorControls ? (<>
              <Layers className="size-4 text-muted-foreground" />
              <Select value={floor?.id ?? ""} onValueChange={selectFloor}>
                <SelectTrigger className="h-8 w-40" aria-label={selectedPropertyType === "flat" ? "当前图纸" : "当前楼层"}><SelectValue placeholder={selectedPropertyType === "flat" ? "选择图纸" : "选择楼层"} /></SelectTrigger>
                <SelectContent>{floors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="h-8 w-32" aria-label={selectedPropertyType === "flat" ? "图纸名称" : "楼层名称"} value={floor?.name ?? ""} onChange={(event) => patchFloor({ name: event.target.value })} disabled={editingDisabled} />
              <Button size="sm" variant="outline" onClick={addFloor} disabled={editingDisabled}><Plus className="size-4" />{selectedPropertyType === "flat" ? "添加图纸" : "添加楼层"}</Button>
              <span className="mr-auto text-xs text-muted-foreground">{floor?.floorplanName || "当前楼层未上传底图"} {floor?.imageWidth ? `· ${floor.imageWidth} × ${floor.imageHeight}` : ""}</span>
            </>) : <span className="mr-auto text-xs text-muted-foreground">平层 · 全屋房间 · {floor?.floorplanName || "未上传户型底图"}</span>}
            <Button
              size="sm"
              variant={tool === "place" ? "secondary" : "ghost"}
              aria-pressed={tool === "place"}
              onClick={() => setTool("place")}
              disabled={editingDisabled}
            >
              <MousePointer2 className="size-4" />
              布点
            </Button>
            <Button
              size="sm"
              variant={tool === "pan" ? "secondary" : "ghost"}
              aria-pressed={tool === "pan"}
              onClick={() => setTool("pan")}
            >
              <Hand className="size-4" />
              平移
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="缩小底图"
              onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))}
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="放大底图"
              onClick={() => setZoom((value) => Math.min(POINT_MAP_MAX_EDITOR_ZOOM, value * 1.25))}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="查看全图"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={!floor?.floorplanDataUrl} onClick={() => focusDrawing([floorPoints.find(point => point.id === activePointId && point.placed) ?? { x: 50, y: 50 }])}>
              <MapPinned className="size-4" />局部布点
            </Button>
          </div>
          <Toolbar
            disabled={editingDisabled}
            products={products.filter((product) => {
              const intent = deviceIntentForIcon(selectedIcon.id);
              return intent && evaluateProductCompatibility(intent, product).status === "compatible";
            })}
            selectedProductId={selectedProductId}
            selectedRoom={selectedRoom}
            roomOptions={availableRooms}
            onProductChange={setSelectedProductId}
            onRoomChange={setSelectedRoom}
          />
        </CardHeader>
        <CardContent className="space-y-3 p-2 pt-0 md:p-3 md:pt-0">
          <PointMapDrawings plan={plan} floor={floor} view={drawingView} disabled={editingDisabled || uploading} onSelect={setDrawingView} onApply={(next, expected) => {
            if (planRef.current !== expected || next.projectId !== projectRef.current || editingDisabledRef.current || pendingUploadsRef.current > 0) return false;
            savePlan(next);
            return true;
          }} />
          <div className="grid gap-2 lg:grid-cols-[148px_minmax(0,1fr)] 2xl:grid-cols-[194px_minmax(0,1fr)]">
            <IconPalette
              disabled={editingDisabled}
              selectedIconId={selectedIconId}
              onDragEnd={() => setDraggingIconId(null)}
              onDragStart={setDraggingIconId}
              onIconChange={selectIcon}
            />
            <div
              ref={viewportRef}
              role="region"
              aria-label="点位图画布"
              data-point-viewport
              className={cn(
                "relative h-[72vh] min-h-96 overflow-hidden rounded-lg border bg-muted/30 touch-none",
                tool === "pan" && "cursor-grab active:cursor-grabbing",
              )}
              onPointerDown={beginPan}
              onPointerMove={(event) => {
                const state = panDragRef.current;
                if (state)
                  setPan({
                    x: state.origin.x + event.clientX - state.x,
                    y: state.origin.y + event.clientY - state.y,
                  });
              }}
              onPointerUp={() => {
                panDragRef.current = null;
              }}
              onPointerCancel={() => {
                panDragRef.current = null;
              }}
            >
              {floor?.floorplanDataUrl ? (
                <div
                  key={`${viewingVersion ?? "draft"}:${floor.id}`}
                  ref={canvasRef}
                  className={cn(
                    "absolute left-1/2 top-1/2 select-none",
                    tool === "place" && !editingDisabled && "cursor-crosshair",
                  )}
                  style={{
                    width: editorGeometry.width,
                    height: editorGeometry.height,
                    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${editorGeometry.fitScale * zoom})`,
                    transformOrigin: "center",
                  }}
                  onPointerDown={addPoint}
                  onDragOver={(event) => {
                    if (!editingDisabled) event.preventDefault();
                  }}
                  onDrop={dropIcon}
                >
                  {drawingView !== "layout" ? (activeReference ? <svg role="img" aria-label={`${floor.name}：${activeReference.name}`} viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none block h-full w-full bg-white">
                    <image href={activeReference.imageDataUrl} width="100" height="100" preserveAspectRatio="none" transform={`matrix(${inverseReferenceMatrix(activeReference.matrix).join(" ")})`} />
                  </svg> : <div role="status" className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-slate-700">{referenceError || "正在校验对照图…"}</div>) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- Image and point coordinates share the same engineering rectangle. */
                  <img
                    src={floor.floorplanDataUrl}
                    alt={`${floor.name}：${floor.floorplanName}`}
                    className="pointer-events-none block h-full w-full"
                    draggable={false}
                    onLoad={(event) =>
                      recordLoadedFloorplanImage(floor.id, event.currentTarget)
                    }
                  />)}
                  {(drawingView === "layout" || activeReference) && visiblePoints
                    .filter((point) => point.placed && individualMarkerIds.has(point.id))
                    .map((point) => {
                      const icon = iconForPoint(point);
                      const position =
                        dragPreview?.pointId === point.id
                          ? dragPreview.position
                          : point;
                      return (
                        <button
                          key={point.id}
                          type="button"
                          data-point-node
                          aria-label={`${point.code || "点位"} ${point.name}，${statusLabels[point.status]}`}
                          aria-pressed={activePointId === point.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              event.detail > 0 &&
                              suppressPointClickRef.current === point.id
                            ) {
                              suppressPointClickRef.current = null;
                              return;
                            }
                            suppressPointClickRef.current = null;
                            if (tool === "pan") return;
                            setActivePointId(point.id);
                            setPointEditorId(point.id);
                          }}
                          onPointerDown={(event) => {
                            if (tool === "pan") return;
                            if (!editingDisabled) beginDrag(point.id, event);
                            else {
                              event.stopPropagation();
                              setActivePointId(point.id);
                            }
                          }}
                          onPointerMove={(event) => {
                            if (draggingPointId === point.id) {
                              event.stopPropagation();
                              previewPointMove(point.id, event);
                            }
                          }}
                          onPointerUp={(event) => endDrag(point.id, event)}
                          onPointerCancel={(event) => endDrag(point.id, event)}
                          onKeyDown={(event) => {
                            const directions: Record<
                              string,
                              { x: number; y: number }
                            > = {
                              ArrowLeft: { x: -1, y: 0 },
                              ArrowRight: { x: 1, y: 0 },
                              ArrowUp: { x: 0, y: -1 },
                              ArrowDown: { x: 0, y: 1 },
                            };
                            const delta = directions[event.key];
                            if (!editingDisabled && tool === "place" && delta) {
                              event.preventDefault();
                              const step = event.shiftKey ? 2 : 0.5;
                              patchPoint(point.id, {
                                x: Math.min(
                                  100,
                                  Math.max(0, point.x + delta.x * step),
                                ),
                                y: Math.min(
                                  100,
                                  Math.max(0, point.y + delta.y * step),
                                ),
                              });
                            }
                          }}
                          className={cn(
                            "group absolute z-10 flex touch-none items-center justify-center rounded-md border border-transparent bg-white/90 p-0 outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary",
                            activePointId === point.id && "border-primary/70",
                            !editingDisabled &&
                              "cursor-grab active:cursor-grabbing",
                          )}
                          style={{
                            left: `${position.x}%`,
                            top: `${position.y}%`,
                            width: POINT_MAP_EDITOR_HIT_SIZE,
                            height: POINT_MAP_EDITOR_HIT_SIZE,
                            transform: markerTransform,
                            zIndex: activePointId === point.id ? 40 : 10,
                          }}
                          title={`${point.code || ""} ${point.name} · ${statusLabels[point.status]}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- Local point symbols. */}
                          <img
                            src={icon.icon}
                            alt=""
                            className="object-contain"
                            style={{ width: POINT_MAP_EDITOR_SYMBOL_SIZE, height: POINT_MAP_EDITOR_SYMBOL_SIZE }}
                            draggable={false}
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-[calc(50%+16px)] left-1/2 h-0.5 w-2 -translate-x-1/2"
                            style={{
                              backgroundColor:
                                pointMarkerStatusColors[point.status],
                            }}
                          />
                          <span
                            className={cn(
                              "pointer-events-none absolute top-1/2 left-[calc(50%+20px)] hidden -translate-y-1/2 whitespace-nowrap rounded bg-white/95 px-1 text-xs font-medium leading-none text-slate-700 group-hover:block group-focus-visible:block",
                              activePointId === point.id && "block",
                            )}
                            style={{
                              textShadow: "0 1px 2px #fff, 0 -1px 2px #fff",
                            }}
                          >
                            {point.code ||
                              `P${String(plan.points.indexOf(point) + 1).padStart(3, "0")}`}
                          </span>
                        </button>
                      );
                    })}
                  {(drawingView === "layout" || activeReference) && markerGroups.filter(group => group.pointIds.length > 1).map(group => {
                    return <button key={group.id} type="button" data-point-node data-point-group aria-label={`${group.pointIds.length} 个相邻点位，点击逐个选择`} className="absolute z-20 flex items-center justify-center rounded-md border border-slate-300 bg-white shadow-sm" style={{ left: `${group.x}%`, top: `${group.y}%`, width: POINT_MAP_EDITOR_HIT_SIZE, height: POINT_MAP_EDITOR_HIT_SIZE, transform: markerTransform }} onPointerDown={event => { if (tool !== "pan") event.stopPropagation(); }} onClick={event => { event.stopPropagation(); if (tool !== "pan") setOverlapPointIds(group.pointIds); }}>
                      <Layers className="size-6 text-slate-700" aria-hidden="true" />
                      <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-slate-800 px-1 text-center text-xs font-semibold leading-5 text-white">{group.pointIds.length}</span>
                    </button>;
                  })}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                  <FileImage className="size-10 text-muted-foreground" />
                  <div>
                    <div className="font-medium">
                      为 {floor?.name || "当前楼层"} 上传底图
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      支持 PNG、JPG、WebP。DWG 先用 CADCraft 导出全部图纸对照，确认采用的方案后再提取净底；也可导入助手整理的点位草稿。
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            图标保持清晰大小，数量角标表示相邻点位，点开可逐个选择。局部布点可放大选中位置，拖动图标仍调整真实安装点；平移模式拖动画布。选中点位后可用方向键微调，Shift
            + 方向键移动 2%。
          </p>
        </CardContent>
      </Card>

      {missingProducts.length > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {missingProducts.length} 个点位的产品 ID
          在当前产品库中不存在，请在点位详情重新关联。未匹配产品不会计入报价。
        </p>
      )}
      {plan.points.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="p-3">
              <CardTitle className="text-sm">房间复核进度</CardTitle>
              <CardDescription className="text-xs">
                {floor?.name} · {floorPoints.length} 个点位
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-0">
              <Button
                type="button"
                size="sm"
                variant={roomFilter === null ? "secondary" : "ghost"}
                className="h-7 w-full justify-start text-xs"
                aria-pressed={roomFilter === null}
                onClick={() => setRoomFilter(null)}
              >
                全部房间
              </Button>
              {roomStats.map((room) => (
                <button
                  key={room.room}
                  type="button"
                  aria-pressed={roomFilter === room.room}
                  onClick={() => setRoomFilter(roomFilter === room.room ? null : room.room)}
                  className={cn(
                    "w-full space-y-1 rounded-md p-1.5 text-left hover:bg-muted",
                    roomFilter === room.room && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span>{room.room}</span>
                    <span className="text-muted-foreground">
                      {room.confirmed}/{room.total}
                    </span>
                  </div>
                  <Progress
                    value={
                      room.total
                        ? Math.round((room.confirmed / room.total) * 100)
                        : 0
                    }
                  />
                </button>
              ))}
              {!roomStats.length && (
                <p className="text-xs text-muted-foreground">
                  当前楼层暂无点位。
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">当前楼层点位清单</CardTitle>
                  <CardDescription className="text-xs">
                    选中点位编辑控制灯组、产品和待复核事项。
                  </CardDescription>
                </div>
                <Badge variant="secondary">{visiblePoints.length}</Badge>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  aria-label="搜索当前楼层点位"
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 pl-9"
                  placeholder="搜索编号、房间、产品、灯组"
                />
              </div>
            </CardHeader>
            <CardContent className="grid max-h-[640px] gap-2 overflow-y-auto p-3 pt-0 md:grid-cols-2 xl:grid-cols-3">
              {visiblePoints.map((point) => (
                <PointEditor
                  key={point.id}
                  active={point.id === activePointId && point.id !== pointEditorId}
                  point={point}
                  products={products}
                  roomOptions={availableRooms}
                  onAddRoom={addFloorRoom}
                  onActivate={() => {
                    setActivePointId(point.id);
                    if (point.placed) focusDrawing([point]);
                    if (!point.placed) {
                      setTool("place");
                      setMessage(`点击底图为 ${point.name} 确定位置。`);
                    }
                  }}
                  onPatch={(patch) => patchPoint(point.id, patch)}
                  onRemove={() => removePoint(point.id)}
                  readOnly={editingDisabled}
                  historical={viewingVersion !== null}
                />
              ))}
              {!visiblePoints.length && (
                <p className="text-sm text-muted-foreground">
                  当前没有匹配点位。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <Dialog open={overlapPointIds !== null && overlapPoints.length > 0} onOpenChange={open => { if (!open) setOverlapPointIds(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>相邻点位 · {overlapPoints.length} 个</DialogTitle><DialogDescription>这些安装点靠得很近。逐个选择可定位并编辑，分组不会合并设备或改变坐标。</DialogDescription></DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {overlapPoints.map(point => <Button key={point.id} variant="outline" className="h-auto w-full justify-start gap-3 py-3 text-left" onClick={() => { setOverlapPointIds(null); setActivePointId(point.id); setPointEditorId(point.id); focusDrawing([point]); }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Local device symbol in the point chooser. */}
              <img src={iconForPoint(point).icon} alt="" className="size-8 shrink-0" /><span className="min-w-0"><span className="block">{point.code || "点位"} · {point.name}</span><span className="block text-xs font-normal text-muted-foreground">{point.room || "未分配房间"} · {iconForPoint(point).name}</span></span>
            </Button>)}
          </div>
          <Button onClick={() => { focusDrawing(overlapPoints); setOverlapPointIds(null); }}>放大查看这一组</Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editorPoint)}
        onOpenChange={(open) => {
          if (!open) setPointEditorId(null);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-lg">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>编辑点位 · {editorPoint?.code || "点位详情"}</DialogTitle>
            <DialogDescription>
              点击同类图标即可更换，完成后请保存草稿。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-1">
            {editorPoint && (
              <PointEditor
                key={editorPoint.id}
                active
                point={editorPoint}
                products={products}
                roomOptions={availableRooms}
                  onAddRoom={addFloorRoom}
                onActivate={() => setActivePointId(editorPoint.id)}
                onPatch={(patch) => patchPoint(editorPoint.id, patch)}
                onRemove={() => removePoint(editorPoint.id)}
                readOnly={editingDisabled}
                historical={viewingVersion !== null}
              />
            )}
          </div>
          <div className="shrink-0 space-y-2 border-t pt-3">
            <p
              role="status"
              aria-live="polite"
              title={editorSaveStatus}
              className={cn(
                "line-clamp-2 text-xs leading-5 text-muted-foreground",
                pointMapSaveError && "text-destructive",
              )}
            >
              {editorSaveStatus}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPointEditorId(null)}
              >
                完成编辑
              </Button>
              <Button
                type="button"
                onClick={() => saveCloud(false)}
                disabled={
                  editingDisabled ||
                  uploading ||
                  !selectedProjectId ||
                  cloudRevision === null ||
                  cloudState === "conflict"
                }
              >
                <Save className="size-4" />
                保存到数据库
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SceneEditor
        scenes={plan.scenes ?? []}
        points={plan.points}
        readOnly={editingDisabled}
        onChange={(scenes) => updatePlan({ scenes })}
      />
    </section>
  );
}

function SceneEditor({
  scenes,
  points,
  readOnly,
  onChange,
}: {
  scenes: PointMapScene[];
  points: PointMapNode[];
  readOnly: boolean;
  onChange: (scenes: PointMapScene[]) => void;
}) {
  const [sceneErrors, setSceneErrors] = React.useState<Record<string, string>>(
    {},
  );
  function patchScene(id: string, patch: Partial<PointMapScene>) {
    setSceneErrors((current) => ({ ...current, [id]: "" }));
    onChange(applyReviewedSceneEdit(scenes, id, patch));
  }
  function toggleSceneConfirmation(scene: PointMapScene) {
    if (scene.status === "confirmed") {
      patchScene(scene.id, { status: "proposed" });
      return;
    }
    const error = pointMapSceneConfirmationError(scene, points);
    if (error) {
      setSceneErrors((current) => ({ ...current, [scene.id]: error }));
      return;
    }
    patchScene(scene.id, { status: "confirmed" });
  }
  return (
    <Card>
      <CardHeader className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">场景与控制说明</CardTitle>
            <CardDescription className="mt-1 text-xs">
              助手建议保持待确认。核对触发方式、动作和关联点位后，逐个确认。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly}
            onClick={() =>
              onChange([
                ...scenes,
                {
                  id: crypto.randomUUID(),
                  name: `新场景 ${scenes.length + 1}`,
                  trigger: "",
                  description: "",
                  pointIds: [],
                  status: "proposed",
                },
              ])
            }
          >
            <Plus className="size-4" />
            添加场景
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-3 pt-0 md:grid-cols-2 xl:grid-cols-3">
        {scenes.map((scene) => (
          <details key={scene.id} className="rounded-lg border p-3" open>
            <summary className="cursor-pointer text-sm font-medium">
              <Badge
                className="mr-2"
                variant={scene.status === "confirmed" ? "default" : "secondary"}
              >
                {scene.status === "confirmed" ? "已确认" : "待确认"}
              </Badge>
              {scene.name}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-1">
                <Label htmlFor={`scene-${scene.id}-name`}>场景名称</Label>
                <Input
                  id={`scene-${scene.id}-name`}
                  value={scene.name}
                  disabled={readOnly}
                  onChange={(event) =>
                    patchScene(scene.id, { name: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`scene-${scene.id}-trigger`}>触发方式</Label>
                <Input
                  id={`scene-${scene.id}-trigger`}
                  value={scene.trigger}
                  disabled={readOnly}
                  onChange={(event) =>
                    patchScene(scene.id, { trigger: event.target.value })
                  }
                  placeholder="如：玄关面板按键、每天 23:00"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`scene-${scene.id}-description`}>
                  动作与条件
                </Label>
                <Textarea
                  id={`scene-${scene.id}-description`}
                  value={scene.description}
                  disabled={readOnly}
                  onChange={(event) =>
                    patchScene(scene.id, { description: event.target.value })
                  }
                  placeholder="灯组亮度、窗帘位置、延时和触发条件"
                />
              </div>
              <fieldset disabled={readOnly} className="space-y-2">
                <legend className="mb-1 text-xs font-medium">
                  关联点位（{scene.pointIds.length} 个）
                </legend>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border p-2">
                  {points.map((point) => (
                    <label
                      key={point.id}
                      className="flex cursor-pointer items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={scene.pointIds.includes(point.id)}
                        onChange={(event) =>
                          patchScene(scene.id, {
                            pointIds: event.target.checked
                              ? [...scene.pointIds, point.id]
                              : scene.pointIds.filter((id) => id !== point.id),
                          })
                        }
                      />
                      <span>
                        {point.code || "点位"} · {point.room} · {point.name}
                      </span>
                    </label>
                  ))}
                  {!points.length && (
                    <span className="text-xs text-muted-foreground">
                      先导入或添加点位。
                    </span>
                  )}
                </div>
              </fieldset>
              {sceneErrors[scene.id] && (
                <p role="alert" className="text-sm text-destructive">
                  {sceneErrors[scene.id]}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant={scene.status === "confirmed" ? "outline" : "default"}
                  disabled={readOnly}
                  onClick={() => toggleSceneConfirmation(scene)}
                >
                  {scene.status === "confirmed" ? "改为待确认" : "确认此场景"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`删除场景 ${scene.name}`}
                  disabled={readOnly}
                  onClick={() =>
                    onChange(scenes.filter((item) => item.id !== scene.id))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </details>
        ))}
        {!scenes.length && (
          <p className="text-sm text-muted-foreground">
            暂无场景，可从助手草稿导入，也可手动添加。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SeparatedValuesInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [text, setText] = React.useState(value.join("，"));
  const inputRef = React.useRef<HTMLInputElement>(null);
  const serialized = value.join("，");
  React.useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(serialized);
  }, [serialized]);
  return (
    <Input
      {...props}
      ref={inputRef}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(
          Array.from(
            new Set(
              event.target.value
                .split(/[，,\n]/)
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ),
        );
      }}
      onBlur={() => setText(serialized)}
    />
  );
}

function JsonDraftUpload({
  disabled,
  onUpload,
}: {
  disabled: boolean;
  onUpload: (file: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="size-4" />
        选择 JSON 文件
      </Button>
      <input
        ref={inputRef}
        type="file"
        aria-label="选择点位草稿 JSON"
        accept="application/json,.json"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          onUpload(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

function hasPlanContent(plan: PointMapPlan) {
  return !isPristinePointMapTemplate(plan);
}

async function readLocalBackup(projectId: string): Promise<PointMapPlan | null> {
  return (await pointMapLocalStore().read(projectId, true))?.plan ?? null;
}

function samePlanContent(plan: PointMapPlan, other: PointMapPlan | null) {
  if (!other) return false;
  try {
    return (
      JSON.stringify(exportPointMapDraft(plan)) ===
      JSON.stringify(exportPointMapDraft(normalizeDesignPlan(other)))
    );
  } catch {
    return false;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "读取失败，请检查数据后重试。";
}

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Toolbar({
  disabled = false,
  products,
  selectedProductId,
  selectedRoom,
  roomOptions,
  onProductChange,
  onRoomChange,
}: {
  disabled?: boolean;
  products: Product[];
  selectedProductId: string;
  selectedRoom: string;
  roomOptions: string[];
  onProductChange: (id: string) => void;
  onRoomChange: (room: string) => void;
}) {
  const roomListId = React.useId();
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 lg:grid-cols-[160px_minmax(220px,1fr)]">
        <div className="grid gap-2">
          <Label className="text-xs" htmlFor={`${roomListId}-input`}>
            房间（可自定义）
          </Label>
          <Input
            id={`${roomListId}-input`}
            list={roomListId}
            className="h-8"
            value={selectedRoom}
            onChange={(event) => onRoomChange(event.target.value)}
            disabled={disabled}
          />
          <datalist id={roomListId}>
            {roomOptions.map((room) => (
              <option key={room} value={room} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">默认产品</Label>
          <Select
            value={selectedProductId || "none"}
            onValueChange={(value) =>
              onProductChange(value === "none" ? "" : value)
            }
            disabled={disabled}
          >
            <SelectTrigger className="h-8" aria-label="默认产品">
              <SelectValue placeholder="选择产品" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">暂不关联产品</SelectItem>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function IconPalette({
  disabled = false,
  selectedIconId,
  onDragEnd,
  onDragStart,
  onIconChange,
}: {
  disabled?: boolean;
  selectedIconId: string;
  onDragEnd: () => void;
  onDragStart: (id: string) => void;
  onIconChange: (id: string) => void;
}) {
  const [category, setCategory] = React.useState<string>(() => findPointIconById(selectedIconId)?.category ?? "开关");
  return (
    <div className="max-h-[72vh] overflow-y-auto rounded-lg border bg-muted/20 p-2">
      <label className="mb-3 grid gap-1 text-xs font-medium">
        设备类别
        <select aria-label="布点设备类别" value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value)} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs">
          {pointIconGroups.map((group) => <option key={group.category} value={group.category}>{group.category}</option>)}
        </select>
      </label>
      {pointIconGroups.filter((group) => group.category === category).map((group) => (
        <div key={group.category} className="mb-3 last:mb-0">
          <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
            {group.category}
          </div>
          <div className="grid grid-cols-4 gap-1.5 2xl:grid-cols-5">
            {group.icons.map((icon) => (
              <button
                key={icon.id}
                type="button"
                draggable={!disabled}
                disabled={disabled}
                aria-label={`${icon.name} ${icon.code}`}
                aria-pressed={selectedIconId === icon.id}
                onDragEnd={onDragEnd}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/x-point-icon",
                    icon.id,
                  );
                  event.dataTransfer.effectAllowed = "copy";
                  onDragStart(icon.id);
                }}
                onClick={() => onIconChange(icon.id)}
                className={cn(
                  "group flex size-7 items-center justify-center rounded-md border bg-background transition hover:border-primary/60 hover:bg-muted active:scale-95",
                  selectedIconId === icon.id &&
                    "border-primary bg-primary/5 ring-2 ring-primary/20",
                )}
                title={`${icon.name} ${icon.code}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Local device vectors share their geometry with CAD blocks. */}
                <img
                  src={icon.icon}
                  alt=""
                  className="size-5 object-contain"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PointEditor({
  active,
  point,
  products,
  roomOptions,
  onAddRoom,
  readOnly = false,
  historical = false,
  onActivate,
  onPatch,
  onRemove,
}: {
  active: boolean;
  point: PointMapNode;
  products: Product[];
  roomOptions: string[];
  onAddRoom: (pointId: string, name: string) => string | null;
  readOnly?: boolean;
  historical?: boolean;
  onActivate: () => void;
  onPatch: (patch: Partial<PointMapNode>) => void;
  onRemove: () => void;
}) {
  const icon = iconForPoint(point);
  const replacementGroup = pointIconReplacementGroup(point.iconId);
  const editorId = React.useId();
  const [addingRoom, setAddingRoom] = React.useState(false);
  const [newRoomName, setNewRoomName] = React.useState("");
  const missingProduct = Boolean(
    !(historical && point.selection) && point.productId &&
    !products.some((product) => product.id === point.productId),
  );

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition",
        active && "border-primary bg-primary/5",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background"
          style={{ borderColor: icon.color }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Local device vectors share their geometry with CAD blocks. */}
          <img
            src={icon.icon}
            alt=""
            className="size-7 object-contain"
            draggable={false}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                point.status === "confirmed"
                  ? "default"
                  : point.status === "changed"
                    ? "destructive"
                    : "secondary"
              }
            >
              {statusLabels[point.status]}
            </Badge>
            <Badge variant="outline">{point.room}</Badge>
            <Badge variant="outline">{point.code || icon.code}</Badge>
          </span>
          <span className="mt-1 block truncate font-medium">{point.name}</span>
          <span
            className={cn(
              "block truncate text-xs",
              missingProduct ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {historical && point.selection ? `${point.selection.name} · ${point.selection.manufacturerModel || point.selection.sku}（历史选型）` : productName(products, point.productId)}
          </span>
        </span>
      </button>

      {active && (
        <div className="mt-3 space-y-3">
          <Separator />
          <div
            role="group"
            aria-label={`更换图标：${replacementGroup.label}`}
            className="min-w-0 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-sm font-medium">更换图标</span>
              <span className="text-xs text-muted-foreground">
                {replacementGroup.label}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {replacementGroup.icons.map((item) => {
                const selected = item.id === point.iconId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={readOnly}
                    aria-label={`更换为${item.name}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected) onPatch({ iconId: item.id });
                    }}
                    className={cn(
                      "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-md border bg-background px-1.5 py-2 text-center text-xs transition hover:border-primary/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                      selected &&
                        "border-primary bg-primary/5 font-medium ring-1 ring-primary",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- These local SVGs also provide the native CAD symbol geometry. */}
                    <img
                      src={item.icon}
                      alt=""
                      className="size-8 object-contain"
                      draggable={false}
                    />
                    <span className="max-w-full whitespace-normal break-words leading-4">
                      {item.name}
                    </span>
                    {selected && (
                      <span className="text-[10px] leading-3 text-primary">
                        当前图标
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              更换后保留位置、编号和点位信息。
              更换类型后需重新关联产品。
            </p>
            <details className="min-w-0 rounded-md border bg-background px-2.5 py-2">
              <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                跨类别更换
              </summary>
              <div className="mt-2 min-w-0">
                <Select
                  value={point.iconId}
                  onValueChange={(iconId) => onPatch({ iconId })}
                  disabled={readOnly}
                >
                  <SelectTrigger aria-label="跨类别更换图标" className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pointIconGroups.map((group) => (
                      <React.Fragment key={group.category}>
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                          {group.category}
                        </div>
                        {group.icons.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </details>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-name`}>点位名称</Label>
            <Input
              id={`${editorId}-name`}
              value={point.name}
              disabled={readOnly}
              onChange={(event) => onPatch({ name: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-code`}>点位编号</Label>
            <Input
              id={`${editorId}-code`}
              value={point.code ?? ""}
              disabled={readOnly}
              onChange={(event) => onPatch({ code: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>房间</Label>
              <Select
                value={point.room || UNASSIGNED_POINT_ROOM}
                disabled={readOnly}
                onValueChange={(value) => {
                  if (value === ADD_ROOM_VALUE) {
                    setAddingRoom(true);
                    return;
                  }
                  onPatch({ room: value });
                }}
              >
                <SelectTrigger aria-label="房间"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {point.room && !roomOptions.includes(point.room) && (
                    <SelectItem value={point.room}>{point.room}</SelectItem>
                  )}
                  {roomOptions.map((room) => (
                    <SelectItem key={room} value={room}>{room}</SelectItem>
                  ))}
                  <SelectItem value={ADD_ROOM_VALUE}>＋ 新增房间</SelectItem>
                </SelectContent>
              </Select>
              {addingRoom && (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const room = onAddRoom(point.id, newRoomName);
                    if (!room) return;
                    setNewRoomName("");
                    setAddingRoom(false);
                  }}
                >
                  <Input
                    aria-label="新房间名称"
                    className="h-8"
                    autoFocus
                    value={newRoomName}
                    onChange={(event) => setNewRoomName(event.target.value)}
                    placeholder="例如：健身房"
                  />
                  <Button type="submit" size="sm" disabled={!normalizeRoomName(newRoomName)}>添加</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingRoom(false); setNewRoomName(""); }}>取消</Button>
                </form>
              )}
            </div>
            <div className="grid gap-2">
              <Label>状态</Label>
              <Select
                value={point.status}
                onValueChange={(status) =>
                  onPatch({ status: status as PointMapStatus })
                }
                disabled={readOnly}
              >
                <SelectTrigger aria-label="点位复核状态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">待定位</SelectItem>
                  <SelectItem value="planned">规划中</SelectItem>
                  <SelectItem value="confirmed">已确认</SelectItem>
                  <SelectItem value="changed">需复核</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <PointSelectionEditor point={point} products={products} readOnly={readOnly} historical={historical} onPatch={onPatch} />
          <PointMaterialsEditor point={point} products={products} readOnly={readOnly} onPatch={onPatch} />
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-targets`}>控制灯组 / 回路</Label>
            <SeparatedValuesInput
              id={`${editorId}-targets`}
              value={point.controlTargets ?? []}
              disabled={readOnly}
              onChange={(controlTargets) => onPatch({ controlTargets })}
              placeholder="如：客厅筒灯，灯带，餐厅吊灯"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-control`}>控制方式</Label>
            <Input
              id={`${editorId}-control`}
              value={point.controlType ?? ""}
              disabled={readOnly}
              onChange={(event) => onPatch({ controlType: event.target.value })}
              placeholder="继电器、调光、场景面板等"
            />
          </div>
          {point.confidence && (
            <p className="text-xs text-muted-foreground">
              助手识图置信度：
              {{ low: "低", medium: "中", high: "高" }[point.confidence]} ·
              请结合原图复核
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-review`}>待复核事项</Label>
            <Textarea
              id={`${editorId}-review`}
              value={point.reviewReason ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                onPatch({ reviewReason: event.target.value })
              }
              placeholder="图纸不清楚、回路待核对、现场需确认的条件"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${editorId}-note`}>施工备注</Label>
            <Textarea
              id={`${editorId}-note`}
              value={point.note}
              disabled={readOnly}
              onChange={(event) => onPatch({ note: event.target.value })}
              placeholder="安装高度、供电、布线和现场注意事项"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="grid gap-1">
                <Label htmlFor={`${editorId}-${axis}`}>
                  {axis.toUpperCase()} 坐标 %
                </Label>
                <Input
                  id={`${editorId}-${axis}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={point[axis]}
                  disabled={readOnly}
                  onChange={(event) => {
                    const number = Number(event.target.value);
                    if (Number.isFinite(number) && number >= 0 && number <= 100)
                      onPatch({ [axis]: number });
                  }}
                />
              </div>
            ))}
          </div>
          {!point.placed && (
            <p className="text-xs text-muted-foreground">
              尚未定位。选中此点位后点击当前楼层底图确定位置。
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Grip className="size-3" />x {point.x.toFixed(1)}% / y{" "}
              {point.y.toFixed(1)}%
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRemove}
              disabled={readOnly}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectSelect({
  disabled = false,
  projects,
  value,
  onChange,
}: {
  disabled?: boolean;
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled || projects.length === 0}
    >
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="暂无项目" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FloorplanUpload({
  disabled = false,
  onUpload,
}: {
  disabled?: boolean;
  onUpload: (file: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="size-4" />
        上传户型图
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="选择当前楼层底图"
        disabled={disabled}
        onChange={(event) => {
          onUpload(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

function seedPlanForPropertyType(plan: PointMapPlan, propertyType: PropertyType): PointMapPlan {
  if (hasPlanContent(plan)) return plan
  const spaces = defaultSpacesForPropertyType(propertyType)
  const floors = spaces.map((space) => ({
    id: space.id,
    name: space.name,
    floorplanName: "",
    floorplanDataUrl: "",
    imageWidth: 0,
    imageHeight: 0,
  }))
  return normalizeDesignPlan({ ...plan, floors, activeFloorId: floors[0]?.id })
}

async function loadPlan(projectId: string) {
  const restored = await pointMapLocalStore().read(projectId);
  return { plan: normalizeDesignPlan(restored?.plan ?? emptyPointMapPlan(projectId)), durable: restored?.durable ?? true };
}

function pointFromEvent(
  event: Pick<
    React.PointerEvent<HTMLElement> | React.DragEvent<HTMLElement>,
    "clientX" | "clientY"
  >,
  element: HTMLElement | null,
) {
  return pointMapPositionFromPointer(event, element?.getBoundingClientRect());
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = src;
  });
}

function iconForPoint(point: PointMapNode) {
  return findPointIconById(point.iconId) ?? pointIconDefinitions[0];
}

function productName(products: Product[], productId: string) {
  return (
    products.find((product) => product.id === productId)?.name ??
    (productId ? `产品不存在：${productId}` : "未关联产品")
  );
}

function toQuoteProduct(
  product: Product & { description?: string | null; sku?: string },
): Product {
  return {
    ...product,
    brand: product.brand,
    category: product.category || "未分类",
    cost: Number(product.cost ?? 0),
    id: product.id,
    image: product.image || "/placeholder.svg",
    name: product.name,
    price: Number(product.price ?? 0),
    spec: product.spec || product.description || product.sku || "",
    tags: product.tags ?? [],
    unit: product.unit || "个",
  };
}

function isProduct(product: Product) {
  return Boolean(product.id && product.name && product.unit);
}
