#!/bin/bash
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)

# Parse command line arguments and environment variables
# Support both --flag and ENVVAR=1 syntax
DRY_RUN=${DRY_RUN:-false}
FORCE=${FORCE:-false}

# Normalize environment variables (1, true, TRUE -> true)
[[ "$DRY_RUN" == "1" || "$DRY_RUN" == "true" || "$DRY_RUN" == "TRUE" ]] && DRY_RUN=true
[[ "$FORCE" == "1" || "$FORCE" == "true" || "$FORCE" == "TRUE" ]] && FORCE=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--force]"
      exit 1
      ;;
  esac
done

# Fetch latest tags
git fetch --tags --prune

REPO_URL="https://github.com/braintrustdata/braintrust-sdk"
TAG_PREFIX="py-sdk-v"
COMMIT=$(git rev-parse --short HEAD)
VERSION=$(bash "$ROOT_DIR/py/scripts/get_version.sh")
TAG="${TAG_PREFIX}${VERSION}"

# Find the most recent version tag for comparison
# If forcing and the tag exists, skip to the previous tag for changeset comparison
if [ "$FORCE" = true ] && git rev-parse "$TAG" >/dev/null 2>&1; then
  LAST_RELEASE=$(git tag -l "${TAG_PREFIX}*" --sort=-v:refname | head -n 2 | tail -n 1)
else
  LAST_RELEASE=$(git tag -l "${TAG_PREFIX}*" --sort=-v:refname | head -n 1)
fi

echo "================================================"
echo " Python SDK Release"
echo "================================================"
echo "version:      ${TAG}"
echo "commit:       ${COMMIT}"
echo "code:         ${REPO_URL}/commit/${COMMIT}"
echo "changeset:    ${REPO_URL}/compare/${LAST_RELEASE}...${COMMIT}"

if [ "$FORCE" = true ]; then
  echo ""
  echo "⚠️  WARNING: Force mode enabled - will overwrite existing tag if present"
fi

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

if [ "$FORCE" = true ]; then
  git tag -f "$TAG" "$COMMIT"
  git push --force origin "$TAG"
else
  git tag "$TAG" "$COMMIT"
  git push origin "$TAG"
fi

echo ""
echo "Tag ${TAG} has been created and pushed to origin. Check GitHub Actions for build progress:"
echo "https://github.com/braintrustdata/braintrust-sdk/actions/workflows/publish-py-sdk.yaml"
echo ""
