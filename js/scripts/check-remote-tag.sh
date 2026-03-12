#!/bin/bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <tag>"
  exit 1
fi

TAG="$1"

if git ls-remote --tags --exit-code origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "ERROR: Release tag ${TAG} already exists on origin"
  exit 1
fi
