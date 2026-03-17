#!/bin/bash

# This script attempts to verify the state of the repo is a candidate for
# release and will fail if it is not.
set -e

RELEASE_BRANCH="${RELEASE_BRANCH:-main}"

# Ensure the current commit is on the configured release branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$RELEASE_BRANCH" ]; then
  git fetch origin "$RELEASE_BRANCH" --depth=1000
  # assert this commit is on the release branch
  if ! git merge-base --is-ancestor "$(git rev-parse HEAD)" "origin/$RELEASE_BRANCH"; then
    echo "ERROR: Current commit is not on the $RELEASE_BRANCH branch"
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
