#!/bin/bash
set -euo pipefail

# Script to prepare smoke tests by building SDK and installing into test directories
# This mimics what CI does

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_DIR="$(cd "$JS_DIR/.." && pwd)"
ARTIFACTS_DIR="$JS_DIR/artifacts"

echo "============================================================"
echo "Preparing Smoke Tests"
echo "============================================================"
echo ""

# Step 0: Restore test files to clean git state
echo "Step 0: Restoring test files to clean state..."
cd "$SCRIPT_DIR/tests"
# Only restore files that are tracked by git and modified
if git diff --quiet --exit-code 2>/dev/null; then
  echo "  ✓ Test files already clean"
else
  git checkout -- . 2>/dev/null || true
  echo "  ✓ Restored test files from git"
fi
echo ""

# Step 1: Build the SDK
echo "Step 1: Building SDK..."
cd "$JS_DIR"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi
echo "Building SDK..."
pnpm run build
echo "✓ SDK built"
echo ""

# Step 2: Pack SDK into artifacts
echo "Step 2: Packing SDK..."
mkdir -p "$ARTIFACTS_DIR"
cd "$JS_DIR"
PACKED_TARBALL=$(npm pack --pack-destination "$ARTIFACTS_DIR" 2>&1 | tail -1)
echo "✓ Packed: $PACKED_TARBALL"
echo ""

# Step 3: Build and pack @braintrust/otel (needed for otel-v1 and nextjs tests)
echo "Step 3: Building @braintrust/otel..."
OTEL_DIR="$SDK_DIR/integrations/otel-js"
if [ -d "$OTEL_DIR" ]; then
  cd "$OTEL_DIR"

  # Install the built braintrust package as a dependency
  BRAINTRUST_TARBALL=$(ls "$ARTIFACTS_DIR"/braintrust-*.tgz | head -n 1)
  if [ -z "$BRAINTRUST_TARBALL" ]; then
    echo "Error: braintrust tarball not found"
    exit 1
  fi

  echo "Installing braintrust and OpenTelemetry dependencies..."
  npm_config_save=false npm_config_lockfile=false pnpm add \
    "file:$BRAINTRUST_TARBALL" \
    "@opentelemetry/api@^1.9.0" \
    "@opentelemetry/core@^1.9.0" \
    "@opentelemetry/exporter-trace-otlp-http@^0.35.0" \
    "@opentelemetry/sdk-trace-base@^1.9.0" || true

  echo "Building @braintrust/otel..."
  pnpm run build

  echo "Packing @braintrust/otel..."
  OTEL_TARBALL=$(npm pack --pack-destination "$ARTIFACTS_DIR" 2>&1 | tail -1)
  echo "✓ Packed: $OTEL_TARBALL"
else
  echo "⚠ @braintrust/otel directory not found, skipping"
fi
echo ""

# Step 4: Backup package.json files before modifications
echo "Step 4: Creating backups of package.json files..."
cd "$SCRIPT_DIR"

# List of tests that need braintrust
TESTS_NEEDING_BRAINTRUST=(
  "cloudflare-worker"
  "nextjs-instrumentation"
  "otel-v1"
  "span"
  "span-jest"
)

# Tests that also need @braintrust/otel
TESTS_NEEDING_OTEL=(
  "otel-v1"
  "nextjs-instrumentation"
)

# Create backups for all tests that will be modified
ALL_TESTS=("${TESTS_NEEDING_BRAINTRUST[@]}" "${TESTS_NEEDING_OTEL[@]}")
for test_name in $(printf '%s\n' "${ALL_TESTS[@]}" | sort -u); do
  test_dir="$SCRIPT_DIR/tests/$test_name"
  if [ -d "$test_dir" ] && [ -f "$test_dir/package.json" ]; then
    cd "$test_dir"
    # Remove old backups first to ensure fresh backups
    rm -f package.json.bak package-lock.json.bak
    if grep -q '"backup"' package.json 2>/dev/null; then
      npm run backup 2>/dev/null || true
      echo "  ✓ Backed up $test_name/package.json"
    fi
  fi
done
echo ""

# Step 5: Install built packages into test directories
echo "Step 5: Installing built packages into test directories..."
cd "$SCRIPT_DIR"

for test_name in "${TESTS_NEEDING_BRAINTRUST[@]}"; do
  test_dir="$SCRIPT_DIR/tests/$test_name"
  if [ -d "$test_dir" ] && [ -f "$test_dir/package.json" ]; then
    echo "Installing braintrust into $test_name..."
    cd "$test_dir"
    # Remove package-lock.json to avoid version conflicts
    rm -f package-lock.json
    npm install --legacy-peer-deps 2>/dev/null || npm install
    npx tsx ../../install-build.ts ../../../artifacts braintrust
    echo "  ✓ $test_name"
  fi
done

for test_name in "${TESTS_NEEDING_OTEL[@]}"; do
  test_dir="$SCRIPT_DIR/tests/$test_name"
  if [ -d "$test_dir" ] && [ -f "$test_dir/package.json" ]; then
    echo "Installing @braintrust/otel into $test_name..."
    cd "$test_dir"
    npx tsx ../../install-build.ts ../../../artifacts otel
    echo "  ✓ $test_name (otel)"
  fi
done

# Special handling for Deno - extract tarball for file:// import
echo "Setting up Deno test..."
DENO_DIR="$SCRIPT_DIR/tests/deno"
if [ -d "$DENO_DIR" ]; then
  cd "$DENO_DIR"
  TARBALL=$(ls "$ARTIFACTS_DIR"/braintrust-*.tgz | head -n 1)
  if [ -n "$TARBALL" ]; then
    echo "Extracting braintrust tarball for Deno..."
    rm -rf build
    mkdir -p build
    tar -xzf "$TARBALL" -C build
    [ -d build/package ] && mv build/package build/braintrust
    echo "  ✓ Deno build extracted"
  fi
fi
echo ""

# Step 6: Build shared test package
echo "Step 6: Building shared test package..."
cd "$SCRIPT_DIR/shared"
if [ ! -d "node_modules" ]; then
  npm ci
fi
npm run build
echo "✓ Shared package built"
echo ""

echo "============================================================"
echo "✓ Preparation complete!"
echo "============================================================"
echo ""
echo "You can now run tests with:"
echo "  ./run-tests.sh"
echo ""
