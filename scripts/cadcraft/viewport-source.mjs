import { fileURLToPath } from "node:url";

/** Read source VIEWPORT data before CADCraft's importer drops target/frozen-layer fields. */
export async function readCadViewportSource(bytes, extension) {
  if (extension.toLowerCase() === ".dxf") return readDxfViewports(bytes);
  const { LibreDwg, Dwg_Error, Dwg_Object_Type } = await import("@mlightcad/libredwg-web");
  const wasmPath = fileURLToPath(new URL("../wasm/", import.meta.resolve("@mlightcad/libredwg-web")));
  const lib = await LibreDwg.create(wasmPath);
  const name = "fmkj-viewport-source.dwg";
  let data;
  try {
    lib.FS.writeFile(name, new Uint8Array(bytes));
    const result = lib.dwg_read_file(name);
    data = result.data;
    if (result.error & Dwg_Error.OUTOFMEM) { lib.dwg_abandon(data); data = undefined; throw new Error("原图视口读取内存不足。"); }
    if (!data || result.error >= Dwg_Error.CLASSESNOTFOUND) throw new Error(`原图视口读取失败 (${result.error})，不导出不完整页面。`);
    // The converter resolves legacy code pages for Chinese layer names.
    const database = lib.convert(data);
    const layerNames = new Map(database.tables.LAYER.entries.map(layer => [layer.handle.toUpperCase(), layer.name]));
    const viewports = new Map();
    for (const pointer of lib.dwg_getall_entity_by_type(data, Dwg_Object_Type.DWG_TYPE_VIEWPORT)) {
      const handle = lib.dwg_obj_get_handle_value(lib.dwg_obj_generic_to_object(pointer)).toString(16).toUpperCase();
      const get = (...fields) => {
        for (const field of fields) { const result = lib.dwg_dynapi_entity_value(pointer, field); if (result.success) return result.data; }
        throw new Error(`视口 ${handle} 缺少原始参数 ${fields.join(" / ")}。`);
      };
      const count = get("num_frozen_layers");
      const ids = count ? lib.dwg_ptr_to_object_ref_ptr_array(get("frozen_layers"), count).map(ref => lib.dwg_ref_get_id(ref).toUpperCase()) : [];
      const frozenLayers = ids.map(id => { if (!layerNames.has(id)) throw new Error(`视口 ${handle} 的冻结图层 ${id} 无法解析。`); return layerNames.get(id); });
      viewports.set(handle, {
        handle, paperCenter: get("center"), displayCenter: get("VIEWCTR"), targetPoint: get("view_target"),
        viewDirection: get("VIEWDIR"), twistAngle: get("VIEWTWIST", "twist_angle"),
        width: get("width"), height: get("height"), viewHeight: get("VIEWSIZE"),
        flags: get("status_flag"), frozenLayers,
      });
    }
    const spatialFilterCount = database.objects.SPATIAL_FILTER?.length ?? 0;
    let renderDxf;
    if (spatialFilterCount) {
      const buffer = new Uint8Array(bytes).buffer;
      renderDxf = lib.dwg_write_dxf(buffer);
      if (!renderDxf) throw new Error("无法保留原始图块裁剪，停止导出。");
    }
    const sourceLayouts = database.objects.LAYOUT.map(layout => {
      const block = database.tables.BLOCK_RECORD.entries.find(b => b.layout === layout.handle);
      if (!block) throw new Error(`布局 ${layout.layoutName} 缺少源图块。`);
      return { name: layout.layoutName, blockName: block.name };
    });
    return { viewports, spatialFilterCount, renderDxf, sourceLayouts, warnings: result.error ? [`DWG 解码提示 ${result.error}；视口目标、角度与冻结图层已单独校验。`] : [] };
  } finally {
    if (data) lib.dwg_free(data);
    if (lib.FS.analyzePath(name, false).exists) lib.FS.unlink(name);
  }
}

const decodeName = name => name.replace(/\\U\+([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
export function readDxfViewports(bytes) {
  const text = bytes.toString("utf8");
  if (text.startsWith("AutoCAD Binary DXF")) throw new Error("请先将二进制 DXF 保存为 ASCII DXF，再导出视口。");
  const lines = text.split(/\r?\n/), records = [];
  let record;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim(), value = lines[i + 1].trim();
    if (code === "0") { record = []; records.push(record); }
    record?.push([code, value]);
  }
  if (!records.some(r => r[0][1] === "SECTION")) throw new Error("DXF 结构无效，不能核对原始视口。");
  const field = (r, code, fallback) => r.find(pair => pair[0] === code)?.[1] ?? fallback;
  const layers = new Map(records.filter(r => r[0][1] === "LAYER").map(r => [field(r, "5", "").toUpperCase(), decodeName(field(r, "2", ""))]));
  const viewports = new Map();
  for (const r of records.filter(r => r[0][1] === "VIEWPORT")) {
    const handle = field(r, "5", "").toUpperCase();
    const number = (code, fallback = 0) => Number(field(r, code, fallback));
    const point = (x, y, z, defaultZ = 0) => ({ x: number(x), y: number(y), z: number(z, defaultZ) });
    const frozenLayers = r.filter(pair => pair[0] === "331").map(pair => {
      const layer = layers.get(pair[1].toUpperCase());
      if (!layer) throw new Error(`视口 ${handle} 的冻结图层无法解析。`);
      return layer;
    });
    viewports.set(handle, { handle, paperCenter: point("10", "20", "30"), displayCenter: point("12", "22", "32"), targetPoint: point("17", "27", "37"), viewDirection: point("16", "26", "36", 1), twistAngle: number("51") * Math.PI / 180, width: number("40"), height: number("41"), viewHeight: number("45"), flags: number("90"), frozenLayers });
  }
  return { viewports, spatialFilterCount: records.filter(r => r[0][1] === "SPATIAL_FILTER").length, renderDxf: records.some(r => r[0][1] === "SPATIAL_FILTER") ? bytes : undefined, warnings: [] };
}

export function sourceViewportProjection(source) {
  const { displayCenter: c, targetPoint: t, viewDirection: d } = source;
  if (![c?.x, c?.y, t?.x, t?.y, t?.z, d?.x, d?.y, d?.z, source.width, source.height, source.viewHeight, source.twistAngle].every(Number.isFinite) || Math.min(source.width, source.height, source.viewHeight) <= 0) throw new Error(`视口 ${source.handle} 参数不完整。`);
  // CADCraft 0.5 cannot represent tilted/twisted or perspective paper viewports.
  if (d.z <= 0 || Math.abs(d.x) + Math.abs(d.y) > Math.abs(d.z) * 1e-9 || Math.abs(source.twistAngle) > 1e-9 || (source.flags & (1 | 65536))) throw new Error(`视口 ${source.handle} 含旋转、三维或特殊裁剪，需在 CAD 中核对，不能导出为空页。`);
  // VIEWCTR is DCS, view_target is WCS: for top views with zero twist, add them.
  // Reading the importer-produced DXF cannot recover the dropped target/frozen refs.
  const center = [t.x + c.x, t.y + c.y];
  const h = source.viewHeight, w = h * source.width / source.height;
  return { center, window: [[center[0] - w / 2, center[1] - h / 2], [center[0] + w / 2, center[1] + h / 2]], frozenLayers: [...source.frozenLayers] };
}

export function isPaperViewportCamera(source) {
  return Math.abs(source.targetPoint.x) + Math.abs(source.targetPoint.y) < 1e-9 && Math.abs(source.displayCenter.x - source.paperCenter.x) + Math.abs(source.displayCenter.y - source.paperCenter.y) < 1e-8 && Math.abs(source.viewHeight - source.height) < 1e-8;
}

/** Only changes the private in-memory export drawing, never the customer's file. */
export async function restoreLayoutViewports(client, sourceViewports, entities) {
  const restored = new Map();
  for (const entity of entities.filter(e => e.geometry?.type === "viewport")) {
    const source = sourceViewports.get(entity.handle.toUpperCase());
    if (!source) throw new Error(`视口 ${entity.handle} 缺少原图参数，停止导出。`);
    const projection = sourceViewportProjection(source);
    const camera = isPaperViewportCamera(source);
    if (!camera) {
      await client.execute("viewport.set", { handle: entity.handle, locked: false });
      await client.execute("viewport.set", { handle: entity.handle, center: projection.center, viewHeight: source.viewHeight, thaw: entity.geometry.frozenLayers ?? [], freeze: projection.frozenLayers });
      await client.execute("viewport.set", { handle: entity.handle, locked: Boolean(source.flags & 16384) });
    }
    restored.set(entity.handle, { ...entity, geometry: { ...entity.geometry, viewCenter: { x: projection.center[0], y: projection.center[1] }, viewHeight: source.viewHeight, frozenLayers: projection.frozenLayers, sourceDisplayCenter: source.displayCenter, sourceTargetPoint: source.targetPoint } });
  }
  return restored;
}
