#!/bin/bash
# Script to validate release requirements
# - Checks if the tag matches the version in the package
# - Ensures we're releasing from the main branch

set -e

# Fetch the latest tags to ensure we're up to date
echo "Fetching latest tags..."
git fetch --tags

# Get the tag from the RELEASE_TAG environment variable
if [ -z "$RELEASE_TAG" ]; then
  echo "ERROR: RELEASE_TAG environment variable not set"
  exit 1
fi

TAG=$RELEASE_TAG
echo "Validating release for tag: $TAG"

# Extract version without the 'v' prefix
VERSION=${TAG#v}

# Get the package version from the version.py file
PACKAGE_VERSION=$(cd py && bash scripts/get_version.sh)

# Check if the tag version matches the package version
if [ "$VERSION" != "$PACKAGE_VERSION" ]; then
  echo "ERROR: Tag version ($VERSION) does not match package version ($PACKAGE_VERSION)"
  exit 1
fi

echo "✅ Tag version matches package version: $VERSION"

# Check if we're on the main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  # If we're in detached HEAD state (which is likely in GitHub Actions with a tag),
  # we need to check if the tag is on the main branch
  if ! git rev-parse "$TAG" &>/dev/null; then
    echo "ERROR: Tag $TAG does not exist in the repository"
    exit 1
  fi

  TAG_COMMIT=$(git rev-parse "$TAG")
  MAIN_CONTAINS=$(git branch --contains $TAG_COMMIT | grep -c "main" || true)

  if [ "$MAIN_CONTAINS" -eq "0" ]; then
    echo "ERROR: Tag $TAG is not on the main branch"
    exit 1
  fi
fi

echo "✅ Tag is on the main branch"

# All checks passed
echo "✅ All validation checks passed"
exit 0
