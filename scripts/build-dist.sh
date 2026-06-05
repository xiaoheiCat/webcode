#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C2W_VERSION="${C2W_VERSION:-v0.8.4}"
C2W_REPO="container2wasm/container2wasm"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) C2W_ARCH="amd64" ;;
  aarch64|arm64) C2W_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

declare -a INSTANCE_IDS=()
declare -a INSTANCE_TITLES=()

normalize_name() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-'
}

install_c2w() {
  local bin_dir="$ROOT/.cache/c2w"
  mkdir -p "$bin_dir"
  if [[ -x "$bin_dir/c2w" ]]; then
    export PATH="$bin_dir:$PATH"
    return
  fi
  local tarball="container2wasm-${C2W_VERSION}-linux-${C2W_ARCH}.tar.gz"
  local url="https://github.com/${C2W_REPO}/releases/download/${C2W_VERSION}/${tarball}"
  echo "Downloading c2w ${C2W_VERSION} (${C2W_ARCH})..." >&2
  curl -fsSL "$url" | tar -xz -C "$bin_dir"
  chmod +x "$bin_dir/c2w" "$bin_dir/c2w-net"
  export PATH="$bin_dir:$PATH"
  c2w --help >/dev/null
}

download_net_proxy() {
  local dest="$ROOT/.cache/c2w-net-proxy.wasm"
  if [[ -f "$dest" ]]; then
    echo "$dest"
    return
  fi
  echo "Downloading c2w-net-proxy.wasm ${C2W_VERSION}..." >&2
  curl -fsSL \
    "https://github.com/${C2W_REPO}/releases/download/${C2W_VERSION}/c2w-net-proxy.wasm" \
    -o "$dest"
  echo "$dest"
}

build_browser_wasi_shim() {
  local cache_root="$ROOT/.cache/browser_wasi_shim"
  local shim_dir="$cache_root/browser_wasi_shim"
  if [[ -f "$shim_dir/index.js" && -f "$shim_dir/wasi_defs.js" ]]; then
    echo "$shim_dir"
    return
  fi
  echo "Building browser_wasi_shim..." >&2
  mkdir -p "$cache_root"
  docker buildx build \
    -f "$ROOT/web/shim/Dockerfile" \
    --output "type=local,dest=$cache_root" \
    "$ROOT/web/shim" >&2
  echo "$shim_dir"
}

render_template() {
  local template="$1"
  local output="$2"
  shift 2
  local content
  content="$(<"$template")"
  while [[ $# -ge 2 ]]; do
    local key="$1"
    local val="$2"
    content="${content//${key}/${val}}"
    shift 2
  done
  mkdir -p "$(dirname "$output")"
  printf '%s' "$content" > "$output"
}

copy_shared_assets() {
  mkdir -p "$ROOT/dist/shared"
  cp -R "$ROOT/web/shared/." "$ROOT/dist/shared/"
  cp "$ROOT/web/shared/sw.js" "$ROOT/dist/sw.js"
}

generate_instances_json() {
  local json="["
  local first=true
  local i
  for i in "${!INSTANCE_IDS[@]}"; do
    if [[ "$first" == true ]]; then
      first=false
    else
      json+=","
    fi
    json+="{\"id\":\"${INSTANCE_IDS[$i]}\",\"title\":\"${INSTANCE_TITLES[$i]}\",\"path\":\"/${INSTANCE_IDS[$i]}/\"}"
  done
  json+="]"
  printf '%s\n' "$json" > "$ROOT/dist/instances.json"
}

generate_root_index() {
  local list_html=""
  local i
  for i in "${!INSTANCE_IDS[@]}"; do
    list_html+="<li class=\"win95-list-item\"><a class=\"win95-list-link\" href=\"/${INSTANCE_IDS[$i]}/\">${INSTANCE_TITLES[$i]}</a></li>"
  done
  render_template \
    "$ROOT/web/template/root-index.html" \
    "$ROOT/dist/index.html" \
    "{{INSTANCE_LIST}}" "$list_html"
}

generate_flush_pages() {
  render_template \
    "$ROOT/web/template/flush.html" \
    "$ROOT/dist/flush/index.html" \
    "{{FLUSH_SCOPE}}" "all" \
    "{{FLUSH_REDIRECT}}" "/"

  local i
  for i in "${!INSTANCE_IDS[@]}"; do
    render_template \
      "$ROOT/web/template/flush.html" \
      "$ROOT/dist/${INSTANCE_IDS[$i]}/flush/index.html" \
      "{{FLUSH_SCOPE}}" "${INSTANCE_IDS[$i]}" \
      "{{FLUSH_REDIRECT}}" "/${INSTANCE_IDS[$i]}/"
  done
}

assemble_product() {
  local name="$1"
  local tag="$2"
  local title="$3"
  local container_dir="$4"
  local out="$ROOT/dist/$name"
  local proxy_wasm="$5"
  local shim_dir="$6"

  echo "Building Docker image $tag ..." >&2
  docker build -t "$tag" "$container_dir" >&2

  echo "Converting $tag -> dist/$name/out.wasm ..." >&2
  mkdir -p "$out"
  c2w "$tag" "$out/out.wasm"

  echo "Assembling dist/$name ..." >&2
  cp -R "$ROOT/web/static/." "$out/"
  cp -R "$shim_dir/." "$out/browser_wasi_shim/"
  cp "$proxy_wasm" "$out/c2w-net-proxy.wasm"
  render_template \
    "$ROOT/web/template/index.html" \
    "$out/index.html" \
    "{{PRODUCT_NAME}}" "$title" \
    "{{INSTANCE_ID}}" "$name"

  INSTANCE_IDS+=("$name")
  INSTANCE_TITLES+=("$title")

  echo "Cleaning up Docker data for $tag ..." >&2
  docker rmi -f "$tag" 2>/dev/null || true
  docker builder prune -af 2>/dev/null || true
  docker system prune -af 2>/dev/null || true
}

main() {
  cd "$ROOT"
  export DOCKER_BUILDKIT=1

  install_c2w
  local proxy_wasm
  proxy_wasm="$(download_net_proxy)"
  local shim_dir
  shim_dir="$(build_browser_wasi_shim)"

  rm -rf "$ROOT/dist"
  mkdir -p "$ROOT/dist"
  cp "$ROOT/web/template/_headers" "$ROOT/dist/_headers"
  copy_shared_assets

  for dir in "$ROOT/containers"/*/; do
    local raw_name dir_name tag title
    raw_name="$(basename "$dir")"
    dir_name="$(normalize_name "$raw_name")"
    tag="webcode-$dir_name"
    title="$raw_name"
    assemble_product "$dir_name" "$tag" "$title" "$dir" "$proxy_wasm" "$shim_dir"
  done

  generate_instances_json
  generate_root_index
  generate_flush_pages

  echo "Build complete. Products in dist/:"
  ls -1 "$ROOT/dist"
}

main "$@"
