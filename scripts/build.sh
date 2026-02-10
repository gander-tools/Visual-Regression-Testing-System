#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

echo "=== Step 1: tsdown bundle ==="
npx tsdown --config "$ROOT_DIR/tsdown.config.ts"

echo ""
echo "=== Step 2: bun compile (Linux x64 + x64-baseline) ==="

# Bun compile needs a single entry point. The bundled CLI already has
# everything inlined except @playwright/test (external, resolved at runtime).
# We use --external to keep playwright as a runtime dependency.

BIN_DIR="$DIST_DIR/bin"
mkdir -p "$BIN_DIR"

bun build "$DIST_DIR/cli.mjs" \
  --compile \
  --target=bun-linux-x64 \
  --external "@playwright/test" \
  --external "playwright" \
  --outfile "$BIN_DIR/visual-regression-linux-x64"

bun build "$DIST_DIR/cli.mjs" \
  --compile \
  --target=bun-linux-x64-baseline \
  --external "@playwright/test" \
  --external "playwright" \
  --outfile "$BIN_DIR/visual-regression-linux-x64-baseline"

echo ""
echo "=== Build complete ==="
echo "Bundled JS:  $DIST_DIR/cli.mjs"
echo "Binary x64:  $BIN_DIR/visual-regression-linux-x64"
echo "Binary x64b: $BIN_DIR/visual-regression-linux-x64-baseline"
echo ""
ls -lh "$BIN_DIR/"
