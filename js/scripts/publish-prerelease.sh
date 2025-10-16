#!/bin/bash
set -euo pipefail

# Script to publish a pre-release version to npm
# Can be used both locally and in CI/CD
#
# Usage: ./publish-prerelease.sh <type> <version>
#   type: beta, alpha, or rc
#   version: explicit version to publish, e.g., 1.2.3-beta.1

# Get directories
ROOT_DIR=$(git rev-parse --show-toplevel)
JS_DIR="$ROOT_DIR/js"

# Parse arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <type> <version>"
  echo ""
  echo "Arguments:"
  echo "  type: beta, alpha, or rc"
  echo "  version: explicit version to publish"
  echo ""
  echo "Examples:"
  echo "  $0 beta 1.2.3-beta.1"
  echo "  $0 alpha 1.2.3-alpha.5"
  echo "  $0 rc 1.2.3-rc.1"
  exit 1
fi

PRERELEASE_TYPE="$1"
VERSION="$2"

# Validate prerelease type
case "$PRERELEASE_TYPE" in
  beta|alpha|rc)
    ;;
  *)
    echo "ERROR: Invalid prerelease type: $PRERELEASE_TYPE"
    echo "Must be one of: beta, alpha, rc"
    exit 1
    ;;
esac

# Validate version format
if [ -z "$VERSION" ]; then
  echo "ERROR: Version cannot be empty"
  exit 1
fi

# Map prerelease type to npm dist-tag
case "$PRERELEASE_TYPE" in
  beta)
    DIST_TAG="beta"
    ;;
  alpha)
    DIST_TAG="alpha"
    ;;
  rc)
    DIST_TAG="next"
    ;;
esac

echo "================================================"
echo " Publishing Pre-release"
echo "================================================"
echo "Type:         $PRERELEASE_TYPE"
echo "Version:      $VERSION"
echo "Dist-tag:     $DIST_TAG"
echo ""

# Save current version for reference
cd "$JS_DIR"
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Set the explicit version (updates package.json temporarily)
echo ""
echo "Setting version to $VERSION..."
npm version "$VERSION" --no-git-tag-version --allow-same-version

NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"
echo ""

# Build the SDK
echo "Building SDK..."
npm install
npm run build
echo "Build complete."
echo ""

# Publish to npm with dist-tag
echo "Publishing to npm..."
echo "Command: npm publish --tag $DIST_TAG"
echo ""

# In CI, just publish. Locally, ask for confirmation
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  # Running in CI - publish without confirmation
  npm publish --tag "$DIST_TAG"
else
  # Running locally - ask for confirmation
  read -p "Ready to publish version $NEW_VERSION to npm with tag @$DIST_TAG? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm publish --tag "$DIST_TAG"
  else
    echo "Publish cancelled."
    echo ""
    echo "Restoring package.json to original version..."
    npm version "$CURRENT_VERSION" --no-git-tag-version --allow-same-version
    exit 1
  fi
fi

echo ""
echo "================================================"
echo " Published Successfully!"
echo "================================================"
echo "Version:      $NEW_VERSION"
echo "Dist-tag:     $DIST_TAG"
echo ""
echo "Users can install via:"
echo "  npm install braintrust@$DIST_TAG"
echo ""
echo "View on npm:"
echo "  https://www.npmjs.com/package/braintrust/v/$NEW_VERSION"
echo ""

# Restore package.json if not in CI (local development)
if [ -z "${CI:-}" ] && [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "Restoring package.json to original version..."
  npm version "$CURRENT_VERSION" --no-git-tag-version --allow-same-version
  echo "Done. Local package.json restored to $CURRENT_VERSION"
fi
