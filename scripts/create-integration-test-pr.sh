#!/bin/bash

# This script creates or updates a PR in the braintrust repository to update the SDK submodule.
#
# Required environment variables:
# - GH_TOKEN: GitHub token with permissions to create PRs in the braintrust repository
# - BRANCH_NAME: Name of the source branch in the SDK repository (e.g. "feature/new-feature")
# - COMMIT_HASH: The commit hash from the SDK repository to update the submodule to
# - PARENT_REPO_PATH: Path to the parent repository
#
# Usage:
#   export GH_TOKEN=<github_token>
#   export BRANCH_NAME=<branch_name>
#   export COMMIT_HASH=<commit_hash>
#   export PARENT_REPO_PATH=<parent_repo_path>
#   ./scripts/create-integration-test-pr.sh

set -euo pipefail

# Check for required environment variables
if [ -z "${GH_TOKEN:-}" ]; then
    echo "Error: GH_TOKEN environment variable is required"
    exit 1
fi

if [ -z "${BRANCH_NAME:-}" ]; then
    echo "Error: BRANCH_NAME environment variable is required"
    exit 1
fi

if [ -z "${COMMIT_HASH:-}" ]; then
    echo "Error: COMMIT_HASH environment variable is required"
    exit 1
fi

if [ -z "${PARENT_REPO_PATH:-}" ]; then
    echo "Error: PARENT_REPO_PATH environment variable is required"
    exit 1
fi

# Generate the parent branch name
PARENT_BRANCH_NAME="${BRANCH_NAME}-sdk-gh-action"

cd "$PARENT_REPO_PATH"

# Create or switch to branch in parent repository
if git ls-remote --heads origin "$PARENT_BRANCH_NAME" | grep -q "$PARENT_BRANCH_NAME"; then
  git checkout "$PARENT_BRANCH_NAME"
  git pull origin "$PARENT_BRANCH_NAME"
else
  git checkout -b "$PARENT_BRANCH_NAME" origin/main
fi

# Update submodule reference
git submodule init
git submodule update --init --recursive
cd sdk
git remote set-url origin https://github.com/braintrustdata/braintrust-sdk.git
git fetch origin

# Create a temporary branch to avoid detached HEAD state
git checkout -b temp_branch
git fetch origin "$COMMIT_HASH"
git checkout "$COMMIT_HASH"

# Get commit author and PR number
COMMIT_AUTHOR=$(git log -1 --format='%an <%ae>')
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')
SDK_PR_URL="https://github.com/braintrustdata/braintrust-sdk/pull/${PR_NUMBER}"

cd ..
git add sdk

# Only commit if there are changes
if ! git diff --staged --quiet; then
  git commit -m "Update SDK submodule to latest commit from $BRANCH_NAME"
  git push origin "$PARENT_BRANCH_NAME"
fi

# Check for existing PR
PR_EXISTS=$(gh pr list --state open --head "$PARENT_BRANCH_NAME" --json number | jq 'length')

# Create Pull Request if not exists
if [ "$PR_EXISTS" = "0" ]; then

  gh pr create \
    --title "[bot] Update SDK submodule to $BRANCH_NAME" \
    --body "This PR updates the SDK submodule to point to the latest commit from the branch $BRANCH_NAME.

Author: $COMMIT_AUTHOR
SDK PR: $SDK_PR_URL

Created automatically by GitHub Actions." \
    --base main \
    --head "$PARENT_BRANCH_NAME"
fi
