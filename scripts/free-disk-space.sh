#!/usr/bin/env bash
# Free disk space on GitHub-hosted runners before WASM builds.
set -euo pipefail

show_disk() {
  echo "=== disk usage: $1 ==="
  df -h / /var/lib/docker 2>/dev/null || df -h /
}

show_disk "before cleanup"

# Remove large preinstalled SDKs/toolchains not needed for this workflow.
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL 2>/dev/null || true
sudo rm -rf "${AGENT_TOOLSDIRECTORY}/Android" "${AGENT_TOOLSDIRECTORY}/dotnet" 2>/dev/null || true

# Drop unused Docker data left on the runner image.
docker system prune -af --volumes 2>/dev/null || true
docker buildx prune -af 2>/dev/null || true

show_disk "after cleanup"
