#!/bin/bash

# Script to validate our release code
# - Ensures we're releasing from the main branch
# - The git status is clean

set -e


ROOT_DIR=$(git rev-parse --show-toplevel)

# Check if the git status is clean
if ! git diff-index --quiet HEAD --; then
  echo "ERROR: Git status is not clean"
  exit 1
fi



CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  # Ensure we have main branch history
  git fetch origin main --depth=1000

  # assert this commit is on the main branch
  if ! git merge-base --is-ancestor "$(git rev-parse HEAD)" origin/main; then
    echo "ERROR: Current commit is not on the main branch"
    exit 1
  else
    echo "brain is on main"
  fi
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean"
  exit 1
fi

# All checks passed
exit 0
