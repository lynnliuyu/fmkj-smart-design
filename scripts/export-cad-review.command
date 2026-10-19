#!/bin/zsh
# Double-click on macOS. File selection and export require no AI session.
set -euo pipefail

script_dir="${0:A:h}"
runtime_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"

fail() {
  print -u2 -- "$1"
  if [[ -t 0 ]]; then read -r "reply?按回车关闭…"; fi
  exit 1
}

print -- 'DWG / DXF 原图逐页导出'
print -- '选择文件后自动生成清晰黑白 PDF、PNG 与双栏对照目录，保留原色切换，全程不需要 AI。'

node_binary="$(command -v node || true)"
if [[ -z "$node_binary" ]] || ! "$node_binary" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  node_binary="$runtime_root/node/bin/node"
fi
[[ -x "$node_binary" ]] || fail '未找到 Node.js 24+。请安装 Node.js 24，或保留现有 Codex 本机运行时。'

cad_binary="${CADCRAFT_CLI:-$(command -v cadcraft-cli || true)}"
if [[ ! -x "$cad_binary" ]]; then
  for candidate in "$HOME"/Downloads/cadcraft-cli-*/cadcraft-cli(Nom); do
    if [[ -x "$candidate" ]]; then cad_binary="$candidate"; break; fi
  done
fi
[[ -x "$cad_binary" ]] || fail '未找到 CADCraft CLI。请将 CADCraft CLI 解压到“下载”目录，或设置 CADCRAFT_CLI。'

poppler_binary="$(command -v pdftoppm || true)"
if [[ ! -x "$poppler_binary" ]]; then poppler_binary="$runtime_root/bin/override/pdftoppm"; fi
[[ -x "$poppler_binary" ]] || fail '未找到 Poppler pdftoppm。请安装 Poppler，或保留现有 Codex 本机运行时。'

extra_args=()
python_binary="$runtime_root/python/bin/python3"
if [[ -x "$python_binary" ]] && "$python_binary" -c 'import pypdf' 2>/dev/null; then
  extra_args=(--python "$python_binary")
fi

if [[ $# -gt 0 ]]; then
  source_path="$1"
else
  source_path="$(/usr/bin/osascript -e 'POSIX path of (choose file with prompt "选择要逐页导出的 DWG 或 DXF 原图")')" || exit 0
fi
[[ -f "$source_path" ]] || fail '所选文件不存在。'

output_parent="$HOME/Documents/繁梦CAD图纸对照"
/bin/mkdir -p "$output_parent"
output_dir="$output_parent/${source_path:t:r}-$(/bin/date '+%Y%m%d-%H%M%S')-$$"
print -- "导出位置：$output_dir"
print -- '大型施工图总览可能需要几分钟。请等待“完成”，不要关闭此窗口。'

if ! "$node_binary" "$script_dir/export-cad-review.mjs" --source "$source_path" --out-dir "$output_dir" --cli "$cad_binary" --pdftoppm "$poppler_binary" "${extra_args[@]}"; then
  fail "导出未完成。原图未覆盖；失败目录为 $output_dir，可核对后删除。"
fi
/usr/bin/open "$output_dir/index.html"
print -- '已完成，已打开图纸对照。现在可以搜索图名、左右选图，或打开 PDF 放大。'
