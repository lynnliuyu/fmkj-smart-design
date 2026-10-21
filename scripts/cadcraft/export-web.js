const byId = id => document.getElementById(id);
const form = byId("export-form"), picker = byId("file"), startButton = byId("export-button");
let selectedFile = null, busy = false, currentJob = null, pollTimer, clockTimer, clockStart = 0;
const labels = { queued: "等待导出", running: "正在导出", succeeded: "导出完成", failed: "导出未完成" };
const seconds = ms => ms == null ? "—" : `${(ms / 1000).toFixed(1)} 秒`;

function showError(message) {
  byId("error").textContent = message;
  byId("error").hidden = !message;
}
function setBusy(value) {
  busy = value;
  document.body.classList.toggle("busy", value);
  picker.disabled = value; byId("color-mode").disabled = value; byId("use-demo").disabled = value;
  byId("scope").disabled = value; byId("space").disabled = value;
  startButton.disabled = value || !selectedFile;
  startButton.firstChild.textContent = value ? "导出中…" : "开始导出";
}
function setFile(file) {
  if (busy || !file) return;
  if (!/\.(dwg|dxf)$/i.test(file.name)) return showError("请选择 DWG 或 DXF 文件。");
  if (!file.size || file.size > 100 * 1024 * 1024) return showError("文件为空或超过 100 MB，请分批整理后重试。");
  selectedFile = file;
  byId("filename").textContent = file.name;
  byId("file-detail").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换`;
  startButton.disabled = false;
  showError("");
}
function tick() {
  const elapsed = Math.max(0, Math.floor((Date.now() - clockStart) / 1000));
  byId("timer").textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function startClock(start) {
  clearInterval(clockTimer); clockStart = start; tick(); clockTimer = setInterval(tick, 1000);
}
async function jsonRequest(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}），请重试。`);
  return body;
}
function anchor(text, url, className) {
  const node = document.createElement("a"); node.textContent = text; node.href = url;
  if (className) node.className = className;
  return node;
}
function renderPages() {
  const category = byId("category").value;
  const query = byId("search").value.trim().toLowerCase();
  const pages = currentJob?.result?.pages ?? [];
  const shown = pages.filter(page => {
    const categoryMatch = category === "all" || (category === "overview" ? page.kind === "overview" : page.kind !== "overview" && page.category === category);
    return categoryMatch && `${page.displayName ?? page.labels.join(" / ")} ${page.space} ${page.id}`.toLowerCase().includes(query);
  });
  const root = byId("pages"); root.replaceChildren();
  for (const page of shown) {
    const article = document.createElement("article"); article.className = "page";
    const title = page.displayName ?? (page.kind === "overview" ? `${page.space} · 原图总览` : page.labels.join(" / ") || "未命名图框");
    const preview = anchor("", page.pngUrl, "preview"); preview.target = "_blank"; preview.rel = "noopener";
    preview.setAttribute("aria-label", `查看 ${title} 高清图片`);
    const img = document.createElement("img"); img.src = page.pngUrl; img.loading = "lazy"; img.alt = title;
    preview.append(img);
    const heading = document.createElement("h3"); heading.textContent = title;
    const source = document.createElement("p"); source.textContent = `${page.space} · ${page.id}`;
    const links = document.createElement("div"); links.className = "page-links";
    // 下载文件名用图号-图名；同源下载优先看 download 属性。
    const names = page.fileNames ?? {};
    const pdfDownload = anchor("下载 PDF", page.pdfUrl); pdfDownload.download = names.pdf ?? `${page.id}.pdf`;
    const pngDownload = anchor("下载 PNG", page.pngUrl); pngDownload.download = names.png ?? `${page.id}.png`;
    links.append(pdfDownload, pngDownload);
    if (page.originalPdfUrl) { const original = anchor("下载原色 PDF", page.originalPdfUrl); original.download = names.originalPdf ?? `${page.id}.original.pdf`; links.append(original); }
    if (page.originalPngUrl) { const original = anchor("下载原色 PNG", page.originalPngUrl); original.download = names.originalPng ?? `${page.id}.original.png`; links.append(original); }
    article.append(preview, heading, source);
    if (page.warning) {
      const warning = document.createElement("p"); warning.className = "page-warning"; warning.textContent = page.warning; article.append(warning);
    }
    article.append(links); root.append(article);
  }
  byId("visible-count").textContent = `显示 ${shown.length} / ${pages.length} 张`;
  byId("empty-results").hidden = shown.length !== 0;
}
function renderResult(job) {
  currentJob = job;
  byId("results").hidden = false;
  byId("result-summary").textContent = `${job.filename}${job.space ? ` · 仅布局“${job.space}”` : ""} · ${job.result.sheetCount} 张识别图框，${job.result.overviewCount} 张总览 · 总用时 ${seconds(job.timings.totalMs)}`;
  byId("downloads").replaceChildren();
  const combined = job.result.files.find(file => file.name === "all-pages.pdf");
  const manifest = job.result.files.find(file => file.name === "manifest.json");
  if (combined) byId("downloads").append(anchor("下载本次图纸 PDF", combined.url));
  if (manifest) byId("downloads").append(anchor("下载来源清单", manifest.url));
  const warnings = job.result.warnings ?? [];
  if (warnings.length) {
    const note = document.createElement("p"); note.className = "page-warning";
    note.textContent = warnings.join("；"); byId("downloads").append(note);
  }
  byId("category").value = "all"; byId("search").value = ""; renderPages();
}
function applyJob(job) {
  currentJob = job;
  if (!selectedFile && job.space) { byId("scope").value = "space"; byId("space").value = job.space; byId("space-label").hidden = false; byId("space").required = true; }
  byId("status-title").textContent = labels[job.status] ?? "准备导出";
  byId("progress").textContent = job.progress ?? (job.status === "queued" ? "已收到文件，等待前面的任务完成。" : "正在读取图纸…");
  for (const [id, key] of [["upload-time", "uploadMs"], ["queue-time", "queueMs"], ["export-time", "exportMs"]]) byId(id).textContent = seconds(job.timings?.[key]);
  if (["succeeded", "failed"].includes(job.status)) {
    clearInterval(clockTimer);
    clockStart = Date.now() - (job.timings?.totalMs ?? 0); tick();
    setBusy(false);
    if (job.status === "succeeded") renderResult(job);
    else showError(job.error || "导出未完成，请检查文件后重试。");
  }
}
async function poll(path) {
  try {
    const job = await jsonRequest(path); applyJob(job);
    if (["queued", "running"].includes(job.status)) pollTimer = setTimeout(() => { void poll(path); }, 1500);
  } catch (error) {
    clearInterval(clockTimer); setBusy(false); byId("status-title").textContent = "查询中断";
    showError(`${error.message} 刷新网页可重新查询最近任务。`);
  }
}
picker.addEventListener("change", () => setFile(picker.files[0]));
for (const event of ["dragenter", "dragover"]) byId("dropzone").addEventListener(event, e => { e.preventDefault(); if (!busy) byId("dropzone").classList.add("drag"); });
for (const event of ["dragleave", "drop"]) byId("dropzone").addEventListener(event, e => { e.preventDefault(); byId("dropzone").classList.remove("drag"); });
byId("dropzone").addEventListener("drop", e => setFile(e.dataTransfer.files[0]));
byId("use-demo").addEventListener("click", async () => {
  const button = byId("use-demo"); button.disabled = true;
  try {
    const response = await fetch("/demo.dxf"); if (!response.ok) throw new Error("演示图纸加载失败，请重试。");
    setFile(new File([await response.blob()], "演示平面图.dxf"));
  } catch (error) { showError(error.message); }
  finally { button.disabled = busy; }
});
byId("category").addEventListener("change", renderPages); byId("search").addEventListener("input", renderPages);
byId("scope").addEventListener("change", () => { byId("space-label").hidden = byId("scope").value !== "space"; byId("space").required = byId("scope").value === "space"; });
form.addEventListener("submit", async event => {
  event.preventDefault(); if (busy || !selectedFile) return;
  clearTimeout(pollTimer); setBusy(true); showError(""); byId("results").hidden = true;
  startClock(Date.now()); byId("status-title").textContent = "正在上传";
  byId("progress").textContent = `正在添加 ${selectedFile.name}…`;
  for (const id of ["upload-time", "queue-time", "export-time"]) byId(id).textContent = "—";
  try {
    const query = new URLSearchParams({ filename: selectedFile.name, colorMode: byId("color-mode").value });
    if (byId("scope").value === "space") { query.set("space", byId("space").value.trim()); query.set("overviews", "skip"); }
    const job = await jsonRequest(`/v1/exports?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: selectedFile });
    history.replaceState(null, "", `/?job=${encodeURIComponent(job.id)}`);
    try { localStorage.setItem("cad-export-last-job", job.statusUrl); } catch { /* Storage may be disabled; this does not affect export. */ }
    applyJob(job); void poll(job.statusUrl);
  } catch (error) { clearInterval(clockTimer); setBusy(false); byId("status-title").textContent = "上传未完成"; showError(error.message); }
});
async function restore() {
  const id = new URLSearchParams(location.search).get("job");
  let path = /^[a-f0-9-]{36}$/.test(id ?? "") ? `/v1/exports/${id}` : null;
  if (!path) { try { path = localStorage.getItem("cad-export-last-job"); } catch { return; } }
  if (!/^\/v1\/exports\/[a-f0-9-]{36}$/.test(path ?? "")) return;
  try {
    const job = await jsonRequest(path);
    if (["queued", "running"].includes(job.status)) { setBusy(true); startClock(Date.parse(job.createdAt)); }
    applyJob(job);
    if (["queued", "running"].includes(job.status)) void poll(path);
  } catch { /* The last job may have been deleted or belong to an earlier server. */ }
}
void restore();
