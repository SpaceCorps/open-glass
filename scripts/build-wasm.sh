#!/usr/bin/env bash
set -euo pipefail

# Ensure standard bin locations are in PATH if available
for bin_dir in "$HOME/.cargo/bin" "/opt/homebrew/bin" "/usr/local/bin" "/Users/rorychatt/homebrew/bin"; do
  if [ -d "$bin_dir" ] && [[ ":$PATH:" != *":$bin_dir:"* ]]; then
    export PATH="$bin_dir:$PATH"
  fi
done

# Resolve directory locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CORE_DIR="$REPO_ROOT/packages/core"
OUT_DIR="$CORE_DIR/dist/wasm"

# Defaults
BUILD_PROFILE="--release"
TARGET="web"
OPT_FLAG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      BUILD_PROFILE="--dev"
      shift
      ;;
    --release)
      BUILD_PROFILE="--release"
      shift
      ;;
    --target)
      if [[ $# -lt 2 ]]; then
        echo "Error: --target requires an argument (web or bundler)" >&2
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    --no-opt)
      OPT_FLAG="--no-opt"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--release|--dev] [--target <web|bundler>] [--no-opt]"
      exit 0
      ;;
    *)
      echo "Warning: Unknown argument: $1" >&2
      shift
      ;;
  esac
done

# Validate target argument
if [[ "$TARGET" != "web" && "$TARGET" != "bundler" ]]; then
  echo "Error: Unsupported target '$TARGET'. Supported targets: web, bundler" >&2
  exit 1
fi

echo "==> Building open-glass WebAssembly engine ($BUILD_PROFILE, target: $TARGET)..."

# 1. Prerequisite Validation: wasm-pack
if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Error: 'wasm-pack' is not installed or not found on PATH." >&2
  echo "To install wasm-pack:" >&2
  echo "  - Via Cargo: cargo install wasm-pack" >&2
  echo "  - Via Homebrew: brew install wasm-pack" >&2
  echo "  - Or official installer: https://rustwasm.github.io/wasm-pack/installer/" >&2
  exit 1
fi

# 2. Prerequisite Validation: wasm32-unknown-unknown target
if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed 2>/dev/null | grep -q "^wasm32-unknown-unknown$"; then
    echo "==> Installing wasm32-unknown-unknown Rust target..."
    rustup target add wasm32-unknown-unknown
  fi
fi

# 3. Compilation Execution
echo "==> Running wasm-pack build..."
WASM_PACK_ARGS=(
  build "$CORE_DIR"
  --out-dir "$OUT_DIR"
  --target "$TARGET"
  $BUILD_PROFILE
)

if [ -n "$OPT_FLAG" ]; then
  WASM_PACK_ARGS+=("$OPT_FLAG")
fi

wasm-pack "${WASM_PACK_ARGS[@]}"

# 4. Post-Build Artifact Organization
# Clean temporary build outputs (.gitignore created by wasm-pack)
if [ -f "$OUT_DIR/.gitignore" ]; then
  rm -f "$OUT_DIR/.gitignore"
fi

# 5. Verify Build Artifacts
REQUIRED_FILES=(
  "open_glass_core.js"
  "open_glass_core_bg.wasm"
  "open_glass_core.d.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
  filepath="$OUT_DIR/$file"
  if [ ! -f "$filepath" ]; then
    echo "Error: Required WebAssembly artifact missing: $filepath" >&2
    exit 1
  fi
  if [ ! -s "$filepath" ]; then
    echo "Error: Generated WebAssembly artifact is empty (0 bytes): $filepath" >&2
    exit 1
  fi
done

echo "==> WebAssembly build complete! Output verified in $OUT_DIR"
