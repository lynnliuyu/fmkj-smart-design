"use client";

import { pointMapEditorGeometry, POINT_MAP_EDITOR_SYMBOL_SIZE, POINT_MAP_EDITOR_HIT_SIZE } from "@/lib/point-map-image-size.mjs";
import { focusPointMapEditorView, POINT_MAP_MAX_EDITOR_ZOOM } from "@/lib/point-map-editor-view";
import { ProjectViewSwitch } from "@/components/projects/project-view-switch";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  Download,
  FileImage,
  Grip,
  Hand,
  Layers,
  MapPin,
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
  Undo2,
  Redo2,
  Sparkles,
  MoreHorizontal,
  X,
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
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { overridePointMapDraft } from "@/lib/point-map-draft-override";
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
} from "./point-map-client";
import {
  applyReviewedPointEdit,
  applyReviewedSceneEdit,
  applyUploadedPointMapFloor,
  fillLoadedPointMapFloorDimensions,
  floorplanPayloadAdvice,
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
import { applyPointMapFloorplanCrop, commitPointMapFloorplanCrop, compactPointMapFloorplan } from "@/lib/point-map-floorplan-crop";
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
/** 画布工具条上的房间筛选占位值；null 表示不筛选。 */
const FILTER_ALL_ROOMS = "__all_rooms__";
const COMPACT_INSPECTOR_QUERY = "(max-width: 1023px)";

function subscribeCompactInspector(onChange: () => void) {
  const query = window.matchMedia(COMPACT_INSPECTOR_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function compactInspectorSnapshot() {
  return window.matchMedia(COMPACT_INSPECTOR_QUERY).matches;
}

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

/**
 * 画布尺寸必须在浏览器绘制之前量好。
 * 用 useEffect 的话，首帧会先按初始尺寸画一次、量完再跳成正确的尺寸 ——
 * 表现就是「打开时跳一下，底图跟着变大小」。用 useLayoutEffect 把测量提前到绘制前。
 */
const useBrowserLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

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
  const compactInspector = React.useSyncExternalStore(
    subscribeCompactInspector,
    compactInspectorSnapshot,
    () => false,
  );
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
  // 从 CAD 导入生成点位：布局名与原图一致才导得对，楼层名只影响草稿里的显示名。
  const [cadSpace, setCadSpace] = React.useState("");
  const [cadFloorName, setCadFloorName] = React.useState("一层");
  const [cadBusy, setCadBusy] = React.useState(false);
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
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [sceneOpen, setSceneOpen] = React.useState(false);
  const [roomsOpen, setRoomsOpen] = React.useState(false);
  const [pointsOpen, setPointsOpen] = React.useState(false);
  const [unplacedOpen, setUnplacedOpen] = React.useState(false);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [localStored, setLocalStored] = React.useState(true);
  const [localRestoring, setLocalRestoring] = React.useState(Boolean(initialProjectId));
  const localWriteSequence = React.useRef(0);
  const [hasBackup, setHasBackup] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  // ⌘Z / ⌘⇧Z 撤销重做。输入框里不拦截，避免抢掉打字时的撤销。
  const historyActionsRef = React.useRef({ undo: () => {}, redo: () => {} });
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
    !selectedProjectId ||
    readOnly ||
    cloudState === "forbidden" ||
    busy ||
    localRestoring;
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
        setMessage(`${errorMessage(error)} 本次修改仍在页面中，请保存草稿或导出 JSON。`);
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
  const markerTransform = `translate(-50%, -50%) scale(${editorGeometry.markerScale / zoom})`;
  function focusDrawing(points: Array<{ x: number; y: number }>) {
    const camera = focusPointMapEditorView(editorGeometry, points, viewportSize, zoom);
    setZoom(camera.zoom);
    setPan(camera.pan);
  }
  const missingProducts = React.useMemo(
    () =>
      plan.points.filter(
        (point) =>
          point.productId &&
          !products.some((product) => product.id === point.productId),
      ),
    [plan.points, products],
  );
  /** 未定位点位在画布上没有标记，必须保留显式入口，否则无法再定位它们。 */
  const unplacedPoints = React.useMemo(
    () => floorPoints.filter((point) => !point.placed),
    [floorPoints],
  );
  const roomStats = React.useMemo(
    () => summarizePointMapRooms(floorPoints),
    [floorPoints],
  );
  /** 房间筛选项取自当前楼层实际点位的房间，和原来的复核面板口径一致。 */
  const filterRoomOptions = React.useMemo(
    () => [
      ...new Set(floorPoints.map((point) => point.room || UNASSIGNED_POINT_ROOM)),
    ],
    [floorPoints],
  );
  const editorPoint = plan.points.find((point) => point.id === pointEditorId);

  const resetViewport = React.useCallback(() => {
    setZoom(1);
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
      setOverrideOpen(false);
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
      if (!active) return null;
      // 读取完成时的本机草稿是与云端比较的基准；此后用户的新编辑属于待保存修改，
      // 不能因为读取期间手快就先报冲突并锁住保存。
      const baseline = planRef.current;
      return { baseline, response: await fetchProjectPointMap(selectedProjectId) };
    }
    void restoreAndFetch()
      .then((payload) => {
        if (!active || !payload) return;
        const { baseline, response: result } = payload;
        setCloudRevision(result.revision);
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
          // 服务端自己补写的字段（选型核验快照、旧版缺失的测量值）不是本机修改；
          // 否则每次保存后重新打开工作台都会误报「有未保存修改 / 云端冲突」。
          const diverged =
            (hasPlanContent(baseline) || pendingUploadsRef.current > 0) &&
            !samePointMapDesignContent(baseline, result.data);
          setDirty(
            (hasPlanContent(local) || pendingUploadsRef.current > 0) &&
              !samePointMapDesignContent(local, result.data),
          );
          if (diverged && result.data) {
            setCloudState("conflict");
            setMessage(
              "本机草稿与云端内容不同（通常是你自己在报价单或另一个标签页改过）。可以先「导出本机 JSON」留档，再点「以本机为准保存」覆盖云端；或点「加载云端草稿」放弃本机修改。",
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

  useBrowserLayoutEffect(() => {
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


  /**
   * 撤销 / 重做。
   *
   * 做法故意最笨：每次改动前把整份方案复制一份压进栈（上限 50 步），撤销就弹出、重做就压回。
   * 不算 diff —— 方案不大，快照最不容易错，也不会和保存/冲突那套语义打架。
   * 600 毫秒内的连续改动合并成一步（比如连着敲楼层名），否则撤销要点几十次。
   */
  const HISTORY_LIMIT = 50;
  const HISTORY_MERGE_MS = 600;
  const historyRef = React.useRef<{ plan: PointMapPlan; at: number }[]>([]);
  const redoRef = React.useRef<PointMapPlan[]>([]);
  const [historyDepth, setHistoryDepth] = React.useState(0);
  const [redoDepth, setRedoDepth] = React.useState(0);

  function syncHistoryDepth() {
    setHistoryDepth(historyRef.current.length);
    setRedoDepth(redoRef.current.length);
  }

  /** 把「改动之前」的这一版存起来。连续操作会合并，不重复压栈。 */
  function pushHistory() {
    // pushHistory 只从 savePlan 进来（用户操作 / 数据加载后），不会在渲染期执行；
    // 这里要的是「这次操作发生在什么时候」，用 Date.now 是唯一合适的选择。
    // eslint-disable-next-line react-hooks/purity -- 事件路径专用，非渲染期
    const now = Date.now();
    const last = historyRef.current[historyRef.current.length - 1];
    if (last && now - last.at < HISTORY_MERGE_MS) {
      last.at = now;
      return;
    }
    historyRef.current.push({ plan: planRef.current, at: now });
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
    syncHistoryDepth();
  }

  /** 真正把一份方案落到状态里（保存和撤销/重做共用这一条路）。 */
  function applyPlanDirect(nextPlan: PointMapPlan) {
    const next = normalizeDesignPlan(nextPlan);
    planRef.current = next;
    setPlan(next);
    setDirty(true);
    void persistLocal(next);
  }

  function undoPlan() {
    if (editingDisabledRef.current) return;
    const entry = historyRef.current.pop();
    if (!entry) return;
    redoRef.current.push(planRef.current);
    applyPlanDirect(entry.plan);
    syncHistoryDepth();
  }

  function redoPlan() {
    if (editingDisabledRef.current) return;
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({ plan: planRef.current, at: 0 });
    applyPlanDirect(next);
    syncHistoryDepth();
  }

  // 渲染期不能写 ref，放到每次渲染后的 effect 里同步最新引用（键盘监听永远拿得到最新的撤销函数）。
  React.useEffect(() => {
    historyActionsRef.current = { undo: undoPlan, redo: redoPlan };
  });
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      event.preventDefault();
      if (event.shiftKey) historyActionsRef.current.redo();
      else historyActionsRef.current.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function savePlan(nextPlan: PointMapPlan) {
    if (editingDisabledRef.current) return;
    pushHistory();
    applyPlanDirect(nextPlan);
  }

  function updatePlan(patch: Partial<PointMapPlan>) {
    savePlan(applyPointMapPlanPatch(planRef.current, patch));
  }

  function selectFloor(floorId: string) {
    const next = normalizeDesignPlan({ ...plan, activeFloorId: floorId });
    planRef.current = next;
    setPlan(next);
    persistLocal(next);
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
      const backupStored = await commitPointMapFloorplanCrop({
        before,
        next,
        floorId: targetFloor,
        source,
        current: () => ({ plan: planRef.current, projectId: projectRef.current, editingDisabled: editingDisabledRef.current }),
        backup: async () => {
          localBackupsRef.current.set(before.projectId, before);
          setHasBackup(true);
          try {
            await pointMapLocalStore().write(before, true);
            return true;
          } catch { return false; /* Keep the in-memory backup available for download. */ }
        },
        apply: savePlan,
      });
      resetViewport();
      const removed = Math.round((1 - result.crop.width * result.crop.height / (floor.imageWidth * floor.imageHeight)) * 100);
      setMessage(`已裁去约 ${removed}% 外围空纸，保留 3% 安全边距。点位、CAD 与风格校准已同步；${backupStored ? "原稿可通过“导出本机备份”取回。" : "原稿备份仅在当前页面有效，请在关闭前点击“导出本机备份”下载。"}当前仅本机草稿，请保存草稿。`);
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

  /**
   * 从 CAD 导入生成点位：把文件交给本实例服务端，由服务端调用我方导入服务。
   * 令牌只在服务端环境变量里，浏览器不接触；返回的是已落库的完整方案。
   */
  async function importCadFile(file: File | null) {
    if (!file || editingDisabled || cadBusy) return;
    const targetProject = selectedProjectId;
    setCadBusy(true);
    try {
      const query = new URLSearchParams({ filename: file.name });
      if (cadSpace.trim()) query.set("space", cadSpace.trim());
      if (cadFloorName.trim()) query.set("floorName", cadFloorName.trim());
      const response = await fetch(
        `/api/projects/${targetProject}/cad-import?${query}`,
        { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `CAD 导入失败（HTTP ${response.status}）。`);
      }
      if (projectRef.current !== targetProject) return;
      const next = normalizeDesignPlan(body.plan);
      planRef.current = next;
      setPlan(next);
      setCloudRevision(body.revision);
      setCloudPlan(next);
      setDirty(false);
      void persistLocal(next);
      resetViewport();
      setMessage(
        `已从 CAD 生成 ${body.added} 个待复核点位（${body.floor ?? "一层"}，底图 ${body.imageWidth}×${body.imageHeight}）` +
          (body.skipped ? `，跳过 ${body.skipped} 个已有点位` : "") +
          "。点位类型按图层归类，房间与型号需人工复核后再确认。",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setCadBusy(false);
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
        `${selectedProject.name}-设计草稿.json`,
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

  async function saveCloud(): Promise<boolean> {
    setPointMapSaveError("");
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再保存。");
      setPointMapSaveError("底图正在读取，请完成后再保存。");
      return false;
    }
    if (editingDisabled || !selectedProjectId) return false;
    if (cloudRevision === null) {
      // 首次读取云端失败时版本号未知，直接提交只会白跑一次；明确说明而不是静默返回。
      const offline = "尚未取到云端版本号，无法保存。请点击「加载云端草稿」重新连接数据库后再保存；本机草稿仍然保留。";
      setMessage(offline);
      setPointMapSaveError(offline);
      return false;
    }
    // 切换页面时的「保存」也走这里：本机草稿与云端冲突时不能覆盖云端，
    // 否则报价页刚删掉的设备会被旧草稿写回。
    if (cloudState === "conflict") {
      const conflict = "本机草稿与云端不一致，未保存（本机草稿仍然保留）。可以点「以本机为准保存」覆盖云端，或点「加载云端草稿」放弃本机修改。";
      setMessage(conflict);
      setPointMapSaveError(conflict);
      return false;
    }
    const current = planRef.current;
    const currentFloor = activePointMapFloor(current);
    const filled = currentFloor
      ? fillLoadedPointMapFloorDimensions(
          current,
          currentFloor.id,
          naturalSize.source,
          naturalSize,
        )
      : current;
    if (filled !== current) savePlan(filled);
    // 提交 planRef.current（已规范化）本身，保存成功后据此确认期间没有并发编辑。
    const submitted = planRef.current;
    const projectId = selectedProjectId;
    setBusy(true);
    try {
      const result = await saveProjectPointMap(submitted, cloudRevision);
      if (projectRef.current !== projectId) return false;
      const saved = result.data ? normalizeDesignPlan(result.data) : submitted;
      setCloudRevision(result.revision);
      setCloudPlan(saved);
      setCloudState("ready");
      // 服务端保存会用当前目录补齐选型核验快照。把返回稿写回本机草稿，
      // 否则下次打开工作台会把服务端核验结果误判成「本机与云端不一致」，
      // 于是「保存草稿」长期停在冲突状态、看起来像保存失败。
      const keptLocalEdits = planRef.current !== submitted;
      if (!keptLocalEdits) {
        planRef.current = saved;
        setPlan(saved);
        void persistLocal(saved);
      }
      setDirty(keptLocalEdits);
      setMessage(
        keptLocalEdits
          ? `云端草稿 r${result.revision} 已保存；保存期间的新修改仍留在本机，请再次保存。`
          : `云端草稿 r${result.revision} 已保存。`,
      );
      // 等待报价快照写入完成，切换到报价页时才能读到最新结果。
      // Saving also retries a previously blocked/failed quote sync, even without design edits.
      await autoSyncQuote(result.revision, projectId);
      if (keptLocalEdits)
        setMessage(
          `云端草稿 r${result.revision} 已保存；保存期间的新修改仍留在本机，请再次保存。`,
        );
      return true;
    } catch (error) {
      if (projectRef.current !== projectId) return false;
      const failure = error instanceof PointMapRequestError ? error : undefined;
      const detail =
        failure?.status === 413
          ? `${errorMessage(error)}${floorplanPayloadAdvice(planRef.current)}`
          : errorMessage(error);
      setPointMapSaveError(detail);
      setCloudState(
        // 版本号用尽是 409，但加载云端草稿也解决不了，不能当成可恢复的冲突。
        failure?.status === 409 && failure.code !== "POINT_MAP_REVISION_LIMIT"
          ? "conflict"
          : failure && [401, 403, 404].includes(failure.status)
            ? "forbidden"
            : failure && [400, 409, 413, 415, 422].includes(failure.status)
              ? "ready"
              : "offline",
      );
      setMessage(detail);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * 单人单机下冲突只来自自己的并发操作（报价页联动、另一个标签页、页面放太久），
   * 因此允许显式「以本机为准」覆盖。覆盖前先读回云端当前稿：它既是要替换掉的内容，
   * 也提供这次写入的基准 revision，所以覆盖不会绕过乐观锁，也不会静默发生。
   */
  async function overrideCloud(): Promise<boolean> {
    if (pendingUploadsRef.current > 0) {
      setMessage("底图正在读取，请完成后再覆盖云端。");
      return false;
    }
    if (!selectedProjectId || busy || cloudState !== "conflict") return false;
    const projectId = selectedProjectId;
    setBusy(true);
    try {
      const outcome = await overridePointMapDraft(
        {
          read: async () => {
            const current = await fetchProjectPointMap(projectId);
            return { plan: current.data, revision: current.revision };
          },
          backup: async (plan) => {
            // 先在内存留一份（关闭页面前都能导出），再写本机备份槽。
            localBackupsRef.current.set(projectId, plan);
            setHasBackup(true);
            await pointMapLocalStore().write(plan, true);
          },
          save: async (plan, expectedRevision) => {
            const saved = await saveProjectPointMap(plan, expectedRevision);
            return { plan: saved.data, revision: saved.revision };
          },
          normalize: normalizeDesignPlan,
        },
        planRef.current,
      );
      if (projectRef.current !== projectId) return false;
      planRef.current = outcome.plan;
      setPlan(outcome.plan);
      void persistLocal(outcome.plan);
      setCloudRevision(outcome.revision);
      setCloudPlan(outcome.plan);
      setCloudState("ready");
      setPointMapSaveError("");
      setDirty(false);
      setMessage(
        `已用本机草稿覆盖云端并保存为 r${outcome.revision}。${
          outcome.backupStored
            ? `被替换的云端 r${outcome.replacedRevision} 已存为本机备份，可用「导出本机备份」取回。`
            : "被替换的云端版本仅在当前页面保留，如需留档请先导出本机备份。"
        }`,
      );
      await autoSyncQuote(outcome.revision, projectId);
      return true;
    } catch (error) {
      if (projectRef.current !== projectId) return false;
      const failure = error instanceof PointMapRequestError ? error : undefined;
      // 覆盖期间云端又被改过：回到冲突态，用户可再点一次，绝不自动重试。
      setCloudState(
        failure?.status === 409 && failure.code !== "POINT_MAP_REVISION_LIMIT"
          ? "conflict"
          : failure && [401, 403, 404].includes(failure.status)
            ? "forbidden"
            : "ready",
      );
      setPointMapSaveError(errorMessage(error));
      setMessage(`覆盖未完成：${errorMessage(error)}`);
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
      setCloudPlan(result.data ? normalizeDesignPlan(result.data) : null);
      setCloudState("ready");
      // 成功重新连上数据库后清掉上一次的保存失败提示，避免旧错误继续显示。
      setPointMapSaveError("");
      setOverrideOpen(false);
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
    cloudState === "loading"
        ? "正在连接云端"
        : cloudState === "offline"
          ? "离线 · 仅本机草稿"
          // 徽章只放最短的状态词：长了会把页头挤成两行，整页高度就跟着变。
          // 详细说明在「处理冲突」弹窗和徽章的悬停提示里。
          : cloudState === "conflict"
            ? "云端冲突"
            : cloudState === "forbidden"
              ? "只读"
              : dirty
                ? "本机有修改 · 尚未保存云端"
                : cloudRevision
                  ? `云端已保存 r${cloudRevision}`
                  : "仅本机草稿 · 云端尚未保存";

  const editorSaveStatus = busy
    ? "正在保存草稿…"
    : cloudState === "loading"
      ? "正在读取数据库…"
      : pointMapSaveError
        ? `保存失败：${pointMapSaveError}`
        : readOnly || cloudState === "forbidden"
          ? "当前只读，无法保存修改。"
          : cloudState === "conflict"
            ? "云端和本机不一致：点页头的「云端冲突」选择要保留哪一份。"
            : cloudState === "offline"
              ? "数据库暂不可用，修改仍在当前页面中。"
              : dirty
                ? "有修改待保存"
                : cloudRevision
                  ? `云端已保存 r${cloudRevision}`
                  : "尚未保存草稿";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      {/*
        顶栏压成一行：页面名、视图切换、保存状态、说明入口，然后才是动作按钮。
        原来这里是「大标题 + 副标题」一块加「状态卡片」一块，在 1366×768 上
        合计占掉约 148 像素 —— 而这些高度本该归画布。
      */}
      {/* 顶栏只有一行：项目、楼层、视图切换，右边撤销/重做/保存。 */}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 lg:h-10 lg:flex-nowrap lg:overflow-hidden">
          {showFloorControls ? (<>
            <Layers className="size-4 shrink-0 text-muted-foreground" />
            <Select value={floor?.id ?? ""} onValueChange={selectFloor}>
              <SelectTrigger className="h-8 w-36" aria-label={selectedPropertyType === "flat" ? "当前图纸" : "当前楼层"}><SelectValue placeholder={selectedPropertyType === "flat" ? "选择图纸" : "选择楼层"} /></SelectTrigger>
              <SelectContent>{floors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </>) : null}
          <span className="hidden text-xs text-muted-foreground 2xl:inline">
            {floor?.floorplanName || "未上传底图"}
            {floor?.imageWidth ? ` · ${floor.imageWidth} × ${floor.imageHeight}` : ""}
          </span>
        <h1 className="sr-only">点位图工作台</h1>
        {selectedProjectId ? <ProjectViewSwitch
          active="point-map"
          projectId={selectedProjectId}
          hasUnsavedChanges={() => dirty}
          onSave={() => saveCloud()}
        /> : null}
        {/* 窄屏放不下那行状态文字，把它挂到徽章上，鼠标停一下就能看到。 */}
        {cloudState === "conflict" ? (
          // 冲突就点这个徽章处理。不额外加按钮 —— 多一个按钮会把页头挤成两行，
          // 整页高度跟着变 32 像素，看起来又是「跳一下」。
          <button
            type="button"
            onClick={() => setConflictOpen(true)}
            disabled={busy || uploading || !selectedProjectId}
            title={message || "本机草稿和云端不一样，点这里处理"}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <Badge variant="destructive" className="cursor-pointer">
              云端冲突 · 点此处理
            </Badge>
          </button>
        ) : (
          <Badge
            title={message}
            variant={cloudState === "forbidden" ? "destructive" : "secondary"}
          >
            {cloudLabel}
          </Badge>
        )}
          {readOnly && <Badge variant="outline">订阅或项目权限只读</Badge>}
          {!localStored && (
            <Badge variant={!dirty && cloudRevision ? "secondary" : "destructive"}>{!dirty && cloudRevision ? "本机缓存不可用 · 已保存数据库" : "本机缓存不可用 · 请保存云端或导出"}</Badge>
          )}
          <p
            role="status"
            aria-live="polite"
            className="hidden max-w-[11rem] truncate text-xs text-muted-foreground 2xl:block"
            title={message}
          >
            {message}
          </p>
          <span className="mr-auto" />
          {/* 「房间进度」「点位清单」这些数字右栏已经有了，点那里的统计就能进 —— 页头不再重复放。 */}
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label="撤销"
            title="撤销（⌘Z）"
            onClick={undoPlan}
            disabled={historyDepth === 0 || editingDisabled}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label="重做"
            title="重做（⌘⇧Z）"
            onClick={redoPlan}
            disabled={redoDepth === 0 || editingDisabled}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label="更多工具"
            title="更多工具：AI 生成点位 / 备份导出 / 底图与 CAD"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal className="size-4" />
          </Button>
          <Button
            size="sm"
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
      </div>
      <div role="group" aria-label="点位复核与场景" className="grid shrink-0 grid-cols-4 gap-1 lg:hidden">
        <Button size="sm" variant="outline" className="px-1 text-xs" disabled={!selectedProjectId} onClick={() => setPointsOpen(true)}>
          点位清单 {floorPoints.length}
        </Button>
        <Button size="sm" variant="outline" className="px-1 text-xs" disabled={!selectedProjectId} onClick={() => setRoomsOpen(true)}>
          房间进度
        </Button>
        <Button size="sm" variant="outline" className="px-1 text-xs" disabled={!selectedProjectId || unplacedPoints.length === 0} onClick={() => setUnplacedOpen(true)}>
          待定位 {unplacedPoints.length}
        </Button>
        <Button size="sm" variant="outline" className="px-1 text-xs" disabled={!selectedProjectId} onClick={() => setSceneOpen(true)}>
          场景与联动
        </Button>
      </div>
      {pointMapSaveError && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          保存失败：{pointMapSaveError}
        </p>
      )}

      {/*
        冲突的处理入口：一个弹窗两个选择，不靠展开面板 ——
        展开面板会改页面高度，弹窗不会。
      */}
      <Dialog
        open={conflictOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setConflictOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>本机草稿和云端不一样</DialogTitle>
            <DialogDescription>
              工作台里有一份没保存到云端的修改，云端也有另一版。先选一种方式继续，就不会一直卡在冲突上。
            </DialogDescription>
          </DialogHeader>
          {cloudPlan ? (
            <p className="text-xs text-muted-foreground">
              云端当前 r{cloudRevision}，共 {cloudPlan.points.length} 个点位。
            </p>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy || uploading}
              onClick={() => {
                setConflictOpen(false);
                loadCloud();
              }}
            >
              加载云端草稿（放弃本机修改）
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={busy || uploading}
              onClick={() => {
                setConflictOpen(false);
                setOverrideOpen(true);
              }}
            >
              以本机为准保存（覆盖云端）
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setConflictOpen(false)}>
              先不处理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={overrideOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setOverrideOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>用本机草稿覆盖云端？</DialogTitle>
            <DialogDescription>
              云端草稿和工作台里的这份不一样，通常是你自己在报价单或另一个标签页改过。继续会用本机这份保存成新版本；
              被替换掉的那一版云端草稿会先存为本机备份，可从「导出本机备份」取回。想先留档，请先点「导出草稿 JSON」。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setOverrideOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setOverrideOpen(false);
                void overrideCloud();
              }}
            >
              确认覆盖并保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
      >
        {/*
          一条工具栏装下「选项目 / 传底图 / 选楼层 / 放点设置」。
          原来的卡片标题「图纸标点」和页头重复，连同三行 CardHeader 一起去掉；
          画布自己的控制（搜索、房间筛选、布点/平移、缩放）改成浮在画布上。
        */}
        {/*
          这一行原来会随内容换行：数据没回来时挤成两行 92px，数据回来后一行 52px，
          画布高度跟着变 40px —— 这就是「跳一下然后变小」。现在钉成 40px、禁止换行，
          无论数据什么时候到，这一行的高度都不再变化。
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/*
            三栏：设备图标 / 画布 / 点位属性。
            属性栏是常驻的 —— 选中/取消选中都不改变列宽，所以图纸永远不会因为编辑而变大变小。
          */}
          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
            {/*
              画布占满这一格，搜索、房间筛选、布点模式与缩放都浮在画布上。
              这几行原来单独占位，合计约 80 像素，现在全部还给画布。
            */}
            {/* 画布有最小高度：窗口再矮也不会被压成一张看不清的图，放不下就让页面滚动。 */}
            <div className="relative min-h-[22rem] min-w-0">
              <div
                ref={viewportRef}
                role="region"
                aria-label="点位图画布"
                data-point-viewport
                className={cn(
                  "absolute inset-0 overflow-hidden rounded-lg bg-muted touch-none",
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
                  key={floor.id}
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
                    .filter((point) => point.placed)
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
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                  <FileImage className="size-10 text-muted-foreground" />
                  <div>
                    <div className="font-medium">
                      为 {floor?.name || "当前楼层"} 上传底图
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      支持 PNG、JPG、WebP。也可以点顶栏的「⋯ 更多工具」，用 CAD 原图或助手给的草稿批量生成待复核点位。
                    </div>
                  </div>
                </div>
              )}

              {/* 浮层随画布宽度换行，避免窄屏的模式按钮盖住搜索和房间筛选。 */}
              <div
                className="absolute inset-x-2 top-2 z-30 flex flex-wrap items-start justify-between gap-2"
                onPointerDown={(event) => event.stopPropagation()}
              >
              <div
                className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card/95 p-1.5 shadow-sm backdrop-blur"
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    aria-label="搜索当前楼层点位"
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-8 w-44 pl-8"
                    placeholder="搜索点位"
                  />
                </div>
                <Select
                  value={roomFilter ?? FILTER_ALL_ROOMS}
                  onValueChange={(value) =>
                    setRoomFilter(value === FILTER_ALL_ROOMS ? null : value)
                  }
                >
                  <SelectTrigger className="h-8 w-32" aria-label="按房间筛选点位">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FILTER_ALL_ROOMS}>全部房间</SelectItem>
                    {filterRoomOptions.map((room) => (
                      <SelectItem key={room} value={room}>
                        {room}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/*
                画布控制分两处放，避免一整条横条盖住底图右下角（那里通常也是房间）。
                模式切换在上、缩放竖排在下，都只占一个很小的角。
              */}
              <div
                role="group"
                aria-label="画布模式"
                className="ml-auto flex items-center gap-0.5 rounded-md border bg-card/95 p-1 shadow-sm backdrop-blur"
              >
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
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!floor?.floorplanDataUrl}
                  title="把画面放大到选中点位"
                  onClick={() => focusDrawing([floorPoints.find((point) => point.id === activePointId && point.placed) ?? { x: 50, y: 50 }])}
                >
                  <MapPinned className="size-4" />
                  局部布点
                </Button>
              </div>
              </div>

              <div
                role="group"
                aria-label="画布缩放"
                className="absolute bottom-2 right-2 z-30 flex flex-col items-center gap-0.5 rounded-md border bg-card/95 p-1 shadow-sm backdrop-blur"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="放大底图"
                  onClick={() => setZoom((value) => Math.min(POINT_MAP_MAX_EDITOR_ZOOM, value * 1.25))}
                >
                  <ZoomIn className="size-4" />
                </Button>
                <span className="py-0.5 text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="缩小底图"
                  onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))}
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span className="my-0.5 h-px w-5 bg-border" aria-hidden="true" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="查看全图"
                  title="回到全图"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <RotateCcw className="size-4" />
                </Button>
              </div>

              {/* 浮层：设备工具条。原来占左侧一整列 148px，现在浮在画布左下角，宽度全还给图纸。 */}
              <div
                className="absolute bottom-2 left-2 z-30 max-w-[calc(100%-5.5rem)] rounded-lg border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <IconPalette
                    disabled={editingDisabled}
                    selectedIconId={selectedIconId}
                    onDragEnd={() => setDraggingIconId(null)}
                    onDragStart={setDraggingIconId}
                    onIconChange={selectIcon}
                  />
                  <span className="h-5 w-px bg-border" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-xs text-muted-foreground" htmlFor="point-map-room">房间</Label>
                    <Input id="point-map-room" list="point-map-room-options" className="h-8 w-28" title="房间名可自定义" value={selectedRoom} onChange={(event) => setSelectedRoom(event.target.value)} disabled={editingDisabled} />
                    <datalist id="point-map-room-options">
                      {availableRooms.map((room) => <option key={room} value={room} />)}
                    </datalist>
                  </div>
                </div>
              </div>
            </div>
            </div>

            {/*
              点位属性栏，常驻。选中或取消选中都不改变这一列的宽度 ——
              所以图纸不会因为「打开/关闭编辑」而变大变小。
            */}
            <aside
              aria-label="点位属性"
              className="hidden min-h-0 flex-col overflow-hidden rounded-xl border bg-card lg:flex"
            >
              <div className="shrink-0 border-b px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">
                    {editorPoint ? `编辑点位 · ${editorPoint.code || "点位"}` : "点位属性"}
                  </span>
                  {editorPoint ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="取消选择"
                      title="取消选择"
                      onClick={() => setPointEditorId(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {editorPoint
                    ? "点同类图标即可更换，改完记得保存草稿。"
                    : "在图纸上点一个点位，属性显示在这里。"}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {editorPoint ? (
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
                  />
                ) : (
                  // 面板常驻就得有用：没选中点位时显示当前楼层的概览，而不是一块空白。
                  <div className="space-y-3">
                    {/* 页头不再有项目选择器了，这里用一行只读文字交代「你在哪个项目」，避免改错项目。 */}
                    <div>
                      <p className="text-xs text-muted-foreground">项目</p>
                      <p className="mt-0.5 truncate text-sm font-medium" title={selectedProject.name}>
                        {selectedProject.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">当前楼层</p>
                      <p className="mt-0.5 text-sm font-medium">{floor?.name || "未选择"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={floor?.floorplanName}>
                        {floor?.floorplanName || "未上传底图"}
                      </p>
                    </div>
                    {/* 统计卡就是入口：数字在哪，入口就在哪，不用再去页头找按钮。 */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPointsOpen(true)}
                        disabled={!selectedProjectId}
                        className="rounded-lg bg-muted/50 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                      >
                        <span className="block text-xs text-muted-foreground">点位清单</span>
                        <span className="mt-0.5 block text-sm font-semibold tabular-nums">
                          {floorPoints.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoomsOpen(true)}
                        disabled={!selectedProjectId}
                        className="rounded-lg bg-muted/50 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                      >
                        <span className="block text-xs text-muted-foreground">房间进度</span>
                        <span className="mt-0.5 block text-sm font-semibold tabular-nums">
                          {floorPoints.filter((point) => point.status === "confirmed").length}
                          <span className="font-normal text-muted-foreground"> / {floorPoints.length}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setUnplacedOpen(true)}
                        disabled={!selectedProjectId || unplacedPoints.length === 0}
                        className="rounded-lg bg-muted/50 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                      >
                        <span className="block text-xs text-muted-foreground">待定位</span>
                        <span
                          className={cn(
                            "mt-0.5 block text-sm font-semibold tabular-nums",
                            unplacedPoints.length > 0 && "text-destructive-strong",
                          )}
                        >
                          {unplacedPoints.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSceneOpen(true)}
                        disabled={!selectedProjectId}
                        className="rounded-lg bg-muted/50 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                      >
                        <span className="block text-xs text-muted-foreground">场景与联动</span>
                        <span className="mt-0.5 block text-sm font-semibold tabular-nums">
                          {plan.scenes?.length ?? 0}
                        </span>
                      </button>
                    </div>
                    <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                      <MousePointer2 className="mt-0.5 size-3.5 shrink-0" />
                      点画布上的任意点位开始编辑；这一栏常驻，图纸大小不会因为编辑而变。
                    </p>
                  </div>
                )}
              </div>
              <div className="shrink-0 space-y-2 border-t p-3">
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
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => saveCloud()}
                  disabled={
                    !editorPoint ||
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
              </div>
            </aside>
          </div>
        </div>
      </div>

      {missingProducts.length > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {missingProducts.length} 个点位的产品 ID
          在当前产品库中不存在，请在点位详情重新关联。未匹配产品不会计入报价。
        </p>
      )}

      {/*
        生成点位、备份导出、底图与 CAD 协作这些是「偶尔才用一次」的功能。
        以前它们固定占着页面最下面两行，现在收进一个弹窗：
        平时看不见，要用点顶栏的「⋯」；下面整块空间还给图纸。
      */}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-h-[85svh] w-full max-w-3xl overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>更多工具</DialogTitle>
            <DialogDescription>
              生成点位、备份导出、底图与 CAD 协作。这些是偶尔才用一次的功能，放在这里不占工作区。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* 这些是偶尔才用的：从顶栏撤下来的楼层设置和图纸对照。 */}
            <details className="rounded-xl border bg-card px-3 py-1.5">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">楼层与底图 · 上传、改名、添加</summary>
              <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="point-map-floor-name" className="text-xs">楼层名称</Label>
              <Input id="point-map-floor-name" className="h-8" value={floor?.name ?? ""} onChange={(event) => patchFloor({ name: event.target.value })} disabled={editingDisabled} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">底图</Label>
              <FloorplanUpload disabled={editingDisabled || uploading} onUpload={uploadFloorplan} />
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={addFloor} disabled={editingDisabled}>
              <Plus className="size-4" />
              {selectedPropertyType === "flat" ? "添加图纸" : "添加楼层"}
            </Button>
              </div>
            </details>
            <details className="rounded-xl border bg-card px-3 py-1.5">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">图纸对照 · 灯光图 / 开关图</summary>
              <div className="mt-3">
          <PointMapDrawings plan={plan} floor={floor} view={drawingView} disabled={editingDisabled || uploading} onSelect={setDrawingView} onApply={(next, expected) => {
            if (planRef.current !== expected || next.projectId !== projectRef.current || editingDisabledRef.current || pendingUploadsRef.current > 0) return false;
            savePlan(next);
            return true;
          }} />
                </div>
            </details>
      {/*
        折起来的一行只占一条细栏，把高度留给画布。
        开合要等云端状态确定后再决定：加载中 plan 是空的，会先判成「没有内容」而展开，
        数据回来后又立刻折回去 —— 页面上就是「跳一下，画布和底图跟着变大小」。
        加上 cloudState !== "loading"，这个判断就只发生一次。
        冲突时也不能展开：展开会把画布从 516 压到 352，整页高度跳 164 像素 ——
        冲突的处理入口改到页头「处理冲突」弹窗里，不再靠展开面板。
      */}
      <details className="rounded-xl border bg-card px-3 py-1.5" open>
        <summary className="cursor-pointer text-xs font-medium">
          <Sparkles className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          AI 生成点位 · 从 CAD 导入，或粘贴助手草稿
        </summary>
        <div className="mt-3 space-y-3">

      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">
          从 CAD 导入生成点位
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            上传原始 DWG / DXF，由本实例服务端调用 CAD 导入服务，按图纸窗口生成干净底图与待复核点位。
            需要先在服务端配置 <code className="text-xs">CAD_IMPORT_SERVICE_URL</code> 与{" "}
            <code className="text-xs">CAD_IMPORT_SERVICE_TOKEN</code>；令牌不会进入浏览器。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cad-space">原图布局名（可选）</Label>
              <Input
                id="cad-space"
                value={cadSpace}
                disabled={editingDisabled || cadBusy}
                onChange={(event) => setCadSpace(event.target.value)}
                placeholder="例如 平面图；留空则导出全部布局"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cad-floor">楼层名</Label>
              <Input
                id="cad-floor"
                value={cadFloorName}
                disabled={editingDisabled || cadBusy}
                onChange={(event) => setCadFloorName(event.target.value)}
                placeholder="一层"
              />
            </div>
          </div>
          <Input
            id="cad-file"
            type="file"
            accept=".dwg,.dxf"
            disabled={editingDisabled || cadBusy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              void importCadFile(file);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {cadBusy
              ? "正在处理：解码图纸、按窗口渲染底图与参考图、提取点位，可能需要几分钟…"
              : "生成的点位是待复核状态，不会自动确认，也不改报价或固定交付版本。"}
          </p>
        </div>
      </details>

      <details className="border-t pt-3">
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
                  variant="outline"
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

        </div>
      </details>
{/* 备份、导出、底图校准与 CAD 回传：和「生成点位」无关，单独一块，免得混在一起找。 */}
      <details className="rounded-xl border bg-card px-3 py-1.5" open>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          备份、导出与 CAD 回传
        </summary>
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
      <PointMapCadPanel
        key={`${selectedProjectId}:${floor?.id ?? ""}`}
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
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={compactInspector && Boolean(editorPoint)} onOpenChange={(open) => { if (!open) setPointEditorId(null); }}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-md">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>编辑点位 · {editorPoint?.code || "点位"}</DialogTitle>
            <DialogDescription>修改后保存草稿；完成编辑只关闭详情。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-1">
            {editorPoint ? <PointEditor
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
            /> : null}
          </div>
          <p role="status" aria-live="polite" className={cn("shrink-0 text-xs leading-5 text-muted-foreground", pointMapSaveError && "text-destructive")}>{editorSaveStatus}</p>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setPointEditorId(null)}>完成编辑</Button>
            <Button onClick={() => saveCloud()} disabled={editingDisabled || uploading || !selectedProjectId || cloudRevision === null || cloudState === "conflict"}>
              <Save className="size-4" />保存草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unplacedOpen} onOpenChange={(open) => setUnplacedOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>待定位点位 · {unplacedPoints.length} 个</DialogTitle>
            <DialogDescription>
              这些点位还没有安装位置，不在画布上显示。选择一个后点击底图确定位置。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {unplacedPoints.map((point) => (
              <Button
                key={point.id}
                variant="outline"
                className="h-auto w-full justify-start gap-3 py-3 text-left"
                disabled={editingDisabled}
                onClick={() => {
                  setUnplacedOpen(false);
                  setTool("place");
                  setActivePointId(point.id);
                  setMessage(`点击底图为 ${point.name} 确定位置。`);
                }}
              >
                <MapPin className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block">
                    {point.code || "点位"} · {point.name}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {point.room || "未分配房间"} · {iconForPoint(point).name}
                  </span>
                </span>
              </Button>
            ))}
            {!unplacedPoints.length && (
              <p className="text-sm text-muted-foreground">
                当前楼层没有待定位点位。
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={roomsOpen} onOpenChange={(open) => setRoomsOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>房间复核进度</DialogTitle>
            <DialogDescription>
              {floor?.name} · {floorPoints.length} 个点位。这里只看各房间复核进度，筛选点位请用画布上方的房间选择。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {roomStats.map((room) => (
              <div key={room.room} className="space-y-1 rounded-md p-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span>{room.room}</span>
                  <span className="text-muted-foreground tabular-nums">
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
              </div>
            ))}
            {!roomStats.length && (
              <p className="text-xs text-muted-foreground">当前楼层暂无点位。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={pointsOpen} onOpenChange={(open) => setPointsOpen(open)}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-4xl">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>当前楼层点位清单</DialogTitle>
            <DialogDescription>
              点一个点位打开它的详情编辑；未定位的点位会进入布点模式。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-1">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {visiblePoints.map((point) => (
                <PointEditor
                  key={point.id}
                  active={point.id === activePointId && point.id !== pointEditorId}
                  point={point}
                  products={products}
                  roomOptions={availableRooms}
                  onAddRoom={addFloorRoom}
                  onActivate={() => {
                    setPointsOpen(false);
                    setActivePointId(point.id);
                    if (point.placed) {
                      focusDrawing([point]);
                      setPointEditorId(point.id);
                      return;
                    }
                    setTool("place");
                    setMessage(`点击底图为 ${point.name} 确定位置。`);
                  }}
                  onPatch={(patch) => patchPoint(point.id, patch)}
                  onRemove={() => removePoint(point.id)}
                  readOnly={editingDisabled}
                  />
              ))}
              {!visiblePoints.length && (
                <p className="text-sm text-muted-foreground">
                  当前没有匹配点位。
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={sceneOpen} onOpenChange={(open) => setSceneOpen(open)}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-3xl">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>场景与控制说明</DialogTitle>
            <DialogDescription>
              助手建议保持待确认。核对触发方式、动作和关联点位后逐个确认；确认设计版本前所有场景都要确认。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-1">
            <SceneEditor
              scenes={plan.scenes ?? []}
              points={plan.points}
              readOnly={editingDisabled}
              onChange={(scenes) => updatePlan({ scenes })}
            />
          </div>
        </DialogContent>
      </Dialog>
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
    <Card className="gap-0 py-0">
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
    // 横向版：挂在画布底部当浮动工具条，不再是左侧一整列。
    <div className="flex min-w-0 items-center gap-2">
      <select
        aria-label="布点设备类别"
        value={category}
        disabled={disabled}
        onChange={(event) => setCategory(event.target.value)}
        className="h-7 shrink-0 rounded-md border bg-background px-1.5 text-xs"
      >
        {pointIconGroups.map((group) => <option key={group.category} value={group.category}>{group.category}</option>)}
      </select>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {pointIconGroups.filter((group) => group.category === category).flatMap((group) => group.icons).map((icon) => (
          <button
            key={icon.id}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            aria-label={`${icon.name} ${icon.code}`}
            aria-pressed={selectedIconId === icon.id}
            onDragEnd={onDragEnd}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-point-icon", icon.id);
              event.dataTransfer.effectAllowed = "copy";
              onDragStart(icon.id);
            }}
            onClick={() => onIconChange(icon.id)}
            className={cn(
              "group flex size-7 shrink-0 items-center justify-center rounded-md border bg-background transition hover:border-primary/60 hover:bg-muted active:scale-95",
              selectedIconId === icon.id && "border-primary bg-primary/5 ring-2 ring-primary/20",
            )}
            title={`${icon.name} ${icon.code}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Local device vectors share their geometry with CAD blocks. */}
            <img src={icon.icon} alt="" className="size-5 object-contain" draggable={false} />
          </button>
        ))}
      </div>
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
    point.productId &&
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
            {productName(products, point.productId)}
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
                      <span className="text-xs leading-4 text-primary">
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
                    disabled={readOnly}
                    value={newRoomName}
                    onChange={(event) => setNewRoomName(event.target.value)}
                    placeholder="例如：健身房"
                  />
                  <Button type="submit" size="sm" disabled={readOnly || !normalizeRoomName(newRoomName)}>添加</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => { setAddingRoom(false); setNewRoomName(""); }}>取消</Button>
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
          <PointSelectionEditor point={point} products={products} readOnly={readOnly} onPatch={onPatch} />
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
