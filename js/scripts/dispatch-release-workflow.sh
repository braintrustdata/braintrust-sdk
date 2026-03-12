#!/bin/bash
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required for this fallback flow"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated"
  exit 1
fi

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

if [ "$BRANCH" = "HEAD" ]; then
  echo "ERROR: Could not determine the current branch. Set BRANCH=<branch> and retry."
  exit 1
fi

if ! git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "ERROR: Branch '$BRANCH' does not exist on origin"
  exit 1
fi

echo "Dispatching publish-js-sdk workflow for branch '$BRANCH'..."
gh workflow run publish-js-sdk.yaml --ref "$BRANCH" -f release_type=stable -f branch="$BRANCH"
echo "Workflow dispatched:"
echo "https://github.com/braintrustdata/braintrust-sdk-javascript/actions/workflows/publish-js-sdk.yaml"
