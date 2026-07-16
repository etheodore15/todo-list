#!/usr/bin/env bash
# Build a product flavor into a deploy directory (see ARCHITECTURE.md).
#
#   ./build-flavor.sh ideatodo            → dist/ideatodo   (repo-root config)
#   ./build-flavor.sh cooee               → dist/cooee      (flavors/cooee config)
#   ./build-flavor.sh cooee /tmp/site/app → custom out dir
#
# A flavor is CONFIG ONLY: engine files are copied verbatim; the flavor
# supplies managed-config.js (+ window.FLAVOR) and manifest.webmanifest, and
# the service-worker cache name is prefixed per flavor so two flavors
# installed on one device never share caches.
set -euo pipefail
FLAVOR=${1:?usage: build-flavor.sh <flavor> [outdir]}
OUT=${2:-dist/$FLAVOR}
SRC=$(cd "$(dirname "$0")" && pwd)
CFG="$SRC/flavors/$FLAVOR"

rm -rf "$OUT"
mkdir -p "$OUT"

# engine files, verbatim
cp "$SRC/app.html" "$SRC/sw.js" "$SRC/icons.css" "$OUT/"
for f in digest.js ai-worker.js; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$OUT/"; done
[ -d "$SRC/icons" ]  && cp -r "$SRC/icons"  "$OUT/"
[ -d "$SRC/vendor" ] && cp -r "$SRC/vendor" "$OUT/"

# flavor config (fall back to repo root = the ideatodo live deployment)
cp "${CFG}/managed-config.js"     "$OUT/managed-config.js"     2>/dev/null || cp "$SRC/managed-config.js" "$OUT/"
cp "${CFG}/manifest.webmanifest"  "$OUT/manifest.webmanifest"  2>/dev/null || cp "$SRC/manifest.webmanifest" "$OUT/"

# per-flavor SW cache namespace (ideatodo keeps its historic name)
if [ "$FLAVOR" != "ideatodo" ]; then
  sed -i.bak "s/'idea-todo-v/'${FLAVOR}-v/; s/'idea-todo-libs-/'${FLAVOR}-libs-/" "$OUT/sw.js"
  rm -f "$OUT/sw.js.bak"
fi

echo "built flavor '$FLAVOR' → $OUT"
