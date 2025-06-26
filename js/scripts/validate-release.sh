#!/bin/bash

# This script attempts to verify the state of the repo is a candidate for
# release and will fail if it is not.
set -e



# Ensure the current branch has been pushed to main (aka tests have passed)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  git fetch origin main --depth=1000
  # assert this commit is on the main branch
  if ! git merge-base --is-ancestor "$(git rev-parse HEAD)" origin/main; then
    echo "ERROR: Current commit is not on the main branch"
    exit 1
  fi
fi


# Assert we aren't releasing any uncommitted code
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean"
  exit 1
fi

# All checks passed
exit 0
