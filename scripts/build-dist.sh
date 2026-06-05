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

normalize_name() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-'
}

product_title() {
  echo "$1" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2); print}'
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
  echo "Downloading c2w ${C2W_VERSION} (${C2W_ARCH})..."
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
  echo "Downloading c2w-net-proxy.wasm ${C2W_VERSION}..."
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
  echo "Building browser_wasi_shim..."
  mkdir -p "$cache_root"
  docker buildx build \
    -f "$ROOT/web/shim/Dockerfile" \
    --output "type=local,dest=$cache_root" \
    "$ROOT/web/shim"
  echo "$shim_dir"
}

assemble_product() {
  local name="$1"
  local tag="$2"
  local title="$3"
  local out="$ROOT/dist/$name"
  local proxy_wasm="$4"
  local shim_dir="$5"

  echo "Converting $tag -> dist/$name/out.wasm ..."
  mkdir -p "$out"
  c2w "$tag" "$out/out.wasm"

  echo "Assembling dist/$name ..."
  cp -R "$ROOT/web/static/." "$out/"
  cp -R "$shim_dir/." "$out/browser_wasi_shim/"
  cp "$proxy_wasm" "$out/c2w-net-proxy.wasm"
  sed "s/{{PRODUCT_NAME}}/$title/g" "$ROOT/web/template/index.html" > "$out/index.html"
}

main() {
  cd "$ROOT"
  export DOCKER_BUILDKIT=1

  install_c2w
  local proxy_wasm
  proxy_wasm="$(download_net_proxy)"
  local shim_dir
  shim_dir="$(build_browser_wasi_shim)"

  echo "Building Docker images..."
  (cd "$ROOT/containers" && bash build-all.sh)

  rm -rf "$ROOT/dist"
  mkdir -p "$ROOT/dist"
  cp "$ROOT/web/template/_headers" "$ROOT/dist/_headers"

  for dir in "$ROOT/containers"/*/; do
    local raw_name dir_name tag title
    raw_name="$(basename "$dir")"
    dir_name="$(normalize_name "$raw_name")"
    tag="webcode-$dir_name"
    title="$(product_title "$dir_name")"
    assemble_product "$dir_name" "$tag" "$title" "$proxy_wasm" "$shim_dir"
  done

  echo "Build complete. Products in dist/:"
  ls -1 "$ROOT/dist"
}

main "$@"
