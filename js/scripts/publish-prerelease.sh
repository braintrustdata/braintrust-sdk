#!/bin/bash
set -euo pipefail

# Script to publish a pre-release version to npm
# Can be used both locally and in CI/CD
#
# Usage: ./publish-prerelease.sh <type> <bump>
#   type: beta, alpha, or rc
#   bump: prerelease, prepatch, preminor, or premajor

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <type> <bump>"
  echo ""
  echo "Arguments:"
  echo "  type: beta, alpha, or rc"
  echo "  bump: prerelease, prepatch, preminor, or premajor"
  echo ""
  echo "Examples:"
  echo "  $0 beta prerelease   # Publish next beta version"
  echo "  $0 alpha prepatch    # Publish alpha with patch bump"
  echo "  $0 rc preminor       # Publish RC with minor bump"
  exit 1
fi

PRERELEASE_TYPE="$1"
VERSION_BUMP="$2"

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

# Validate version bump
case "$VERSION_BUMP" in
  prerelease|prepatch|preminor|premajor)
    ;;
  *)
    echo "ERROR: Invalid version bump: $VERSION_BUMP"
    echo "Must be one of: prerelease, prepatch, preminor, premajor"
    exit 1
    ;;
esac

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
echo "Bump:         $VERSION_BUMP"
echo "Dist-tag:     $DIST_TAG"
echo ""

# Save current version for reference
cd "$JS_DIR"
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Create pre-release version (updates package.json temporarily)
echo ""
echo "Creating pre-release version..."
npm version "$VERSION_BUMP" --preid="$PRERELEASE_TYPE" --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"
echo ""

# Build the SDK
echo "Building SDK..."
pnpm install
make build
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
