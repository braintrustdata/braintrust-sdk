#!/bin/bash
# Script to validate release requirements
# - Checks if the tag matches the version in the package
# - Ensures we're releasing from the main branch

set -e

# Get the tag from the first command line argument
if [ $# -eq 0 ]; then
  echo "ERROR: Release tag argument not provided"
  echo "Usage: $0 <release-tag>"
  exit 1
fi

ROOT_DIR=$(git rev-parse --show-toplevel)

# Fetch the latest tags to ensure we're up to date
git fetch --tags --prune

TAG=$1

# Check if tag starts with py-sdk-v
if [[ ! "$TAG" =~ ^py-sdk-v ]]; then
  echo "ERROR: Tag must start with 'py-sdk-v'"
  exit 1
fi

# Extract version without the 'py-sdk-v' prefix
VERSION=${TAG#py-sdk-v}

PACKAGE_VERSION=$(bash "$ROOT_DIR/py/scripts/get_version.sh")

# Check if the tag version matches the package version
if [ "$VERSION" != "$PACKAGE_VERSION" ]; then
  echo "ERROR: Tag version ($VERSION) does not match package version ($PACKAGE_VERSION)"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  # If we're in detached HEAD state (which is likely in GitHub Actions with a tag),
  # we need to check if the tag is on the main branch
  if ! git rev-parse "$TAG" &>/dev/null; then
    echo "ERROR: Tag $TAG does not exist in the repository"
    exit 1
  fi

  TAG_COMMIT=$(git rev-parse "$TAG")

  # Ensure we have main branch history
  git fetch origin main --depth=1000

  # Check if tag is on main branch
  if ! git merge-base --is-ancestor "$TAG_COMMIT" origin/main; then
    echo "ERROR: Tag $TAG is not on the main branch"
    exit 1
  fi
fi

# All checks passed
exit 0
