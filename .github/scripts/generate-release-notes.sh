#!/bin/bash
# Script to generate release notes filtered by path
# Usage: generate-release-notes.sh <current-tag> <path-filter>
# Example: generate-release-notes.sh js-sdk-v0.4.6 js/

set -e

if [ $# -lt 2 ]; then
  echo "ERROR: Required arguments not provided"
  echo "Usage: $0 <current-tag> <path-filter>"
  exit 1
fi

CURRENT_TAG=$1
PATH_FILTER=$2

# Extract the SDK prefix (js-sdk or py-sdk)
SDK_PREFIX=$(echo "$CURRENT_TAG" | sed -E 's/^([^-]+-[^-]+)-.*/\1/')

# Find the previous tag for this SDK
PREVIOUS_TAG=$(git tag --list "${SDK_PREFIX}-v*" --sort=-v:refname | grep -v "^${CURRENT_TAG}$" | head -1)

if [ -z "$PREVIOUS_TAG" ]; then
  PREVIOUS_TAG=$(git rev-list --max-parents=0 HEAD)
fi

# Generate the changelog
CHANGELOG=$(git log ${PREVIOUS_TAG}..${CURRENT_TAG} --oneline --no-merges -- ${PATH_FILTER})

if [ -z "$CHANGELOG" ]; then
  echo "## Changelog"
  echo ""
  echo "No changes found in ${PATH_FILTER} since ${PREVIOUS_TAG}"
else
  echo "## Changelog"
  echo ""

  # Format each commit as a markdown list item with PR link
  while IFS= read -r line; do
    # Extract commit hash and message
    COMMIT_HASH=$(echo "$line" | awk '{print $1}')
    COMMIT_MSG=$(echo "$line" | cut -d' ' -f2-)

    # Extract PR number if present (match the last occurrence)
    if [[ $COMMIT_MSG =~ \(#([0-9]+)\)[[:space:]]*$ ]]; then
      PR_NUM="${BASH_REMATCH[1]}"
      # Remove PR number from message (only the last occurrence)
      CLEAN_MSG=$(echo "$COMMIT_MSG" | sed -E 's/[[:space:]]*\(#[0-9]+\)[[:space:]]*$//')
      echo "* ${CLEAN_MSG} (#${PR_NUM})"
    else
      echo "* ${COMMIT_MSG}"
    fi
  done <<< "$CHANGELOG"
fi
