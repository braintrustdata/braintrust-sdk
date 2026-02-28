#!/bin/bash
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
JS_DIR="$ROOT_DIR/js"

# Parse command line arguments
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run]"
      exit 1
      ;;
  esac
done

# Fetch latest tags
git fetch --tags --prune

REPO_URL="https://github.com/braintrustdata/braintrust-sdk-javascript"
TAG_PREFIX="js-sdk-v"
COMMIT=$(git rev-parse --short HEAD)

# Extract version from package.json
VERSION=$(node -p "require('$JS_DIR/package.json').version")
TAG="${TAG_PREFIX}${VERSION}"

# Validation before pushing
echo "Running pre-push validation..."

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

# Check working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean"
  exit 1
fi

# Ensure we're on main branch or commit is on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  git fetch origin main --depth=1000
  if ! git merge-base --is-ancestor "$(git rev-parse HEAD)" origin/main; then
    echo "ERROR: Current commit is not on the main branch"
    exit 1
  fi
fi

# Run the existing validate-release.sh script
echo "Running validate-release.sh..."
cd "$JS_DIR"
./scripts/validate-release.sh
cd "$ROOT_DIR"

# Find the most recent version tag
LAST_RELEASE=$(git tag -l "${TAG_PREFIX}*" --sort=-v:refname | head -n 1)

echo "================================================"
echo " JavaScript SDK Release"
echo "================================================"
echo "version:      ${TAG}"
echo "commit:       ${COMMIT}"
echo "code:         ${REPO_URL}/commit/${COMMIT}"
echo "changeset:    ${REPO_URL}/compare/${LAST_RELEASE}...${COMMIT}"

if [ "$DRY_RUN" = true ]; then
  exit 0
fi

echo ""
echo ""
echo "Are you ready to release version ${VERSION}? Type 'YOLO' to continue:"
read -r CONFIRMATION

if [ "$CONFIRMATION" != "YOLO" ]; then
  echo "Release cancelled."
  exit 1
fi

# Create and push the tag
echo ""
echo "Creating and pushing tag ${TAG}"
echo ""

git tag "$TAG" "$COMMIT"
git push origin "$TAG"

echo ""
echo "Tag ${TAG} has been created and pushed to origin. Check GitHub Actions for build progress:"
echo "https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml"
echo ""
