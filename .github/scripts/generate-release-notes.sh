#!/bin/bash
# Script to generate release notes filtered by path
# Usage: generate-release-notes.sh <current-tag> <path-filter>
# Example: generate-release-notes.sh js-sdk-v0.4.6 js/

set -euo pipefail

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
PREVIOUS_TAG=$(git tag --list "${SDK_PREFIX}-v*" --sort=-v:refname | grep -v "^${CURRENT_TAG}$" | head -1 || true)

if [ -z "$PREVIOUS_TAG" ]; then
  PREVIOUS_TAG=$(git rev-list --max-parents=0 HEAD)
fi

# Detect the GitHub repository for PR links
REPO_URL=$(git remote get-url origin 2>/dev/null | sed -E 's|git@github.com:|https://github.com/|; s|\.git$||')

# Generate the changelog
CHANGELOG=$(git log "${PREVIOUS_TAG}..${CURRENT_TAG}" --oneline --no-merges -- "${PATH_FILTER}")

if [ -z "$CHANGELOG" ]; then
  echo "## Changelog"
  echo ""
  echo "No changes found in ${PATH_FILTER} since ${PREVIOUS_TAG}"
else
  # Format a commit message as a markdown list item with PR link
  # Args: $1=type prefix, $2=commit message (without hash)
  format_line() {
    local type="$1"
    local msg="$2"

    # Strip the conventional commit prefix (e.g. "feat: ", "fix(scope): ")
    local display
    display=$(echo "$msg" | sed -E 's/^[a-zA-Z]+(\([^)]*\))?:[[:space:]]*//')

    # Capitalize the first letter
    display="$(echo "${display:0:1}" | tr '[:lower:]' '[:upper:]')${display:1}"

    # Label perf commits explicitly
    if [ "$type" = "perf" ]; then
      display="(perf) ${display}"
    fi

    # Format PR link if present
    if [[ $display =~ \(#([0-9]+)\)[[:space:]]*$ ]]; then
      local pr_num="${BASH_REMATCH[1]}"
      local clean
      clean=$(echo "$display" | sed -E 's/[[:space:]]*\(#[0-9]+\)[[:space:]]*$//')
      echo "* ${clean} ([#${pr_num}](${REPO_URL}/pull/${pr_num}))"
    else
      echo "* ${display}"
    fi
  }

  # Print a changelog section if it has content
  print_section() {
    local title="$1"
    local content="$2"
    if [ -n "$content" ]; then
      echo "### ${title}"
      echo ""
      printf "%s" "$content"
      echo ""
    fi
  }

  # Bucket commits by conventional commit type
  FEATURES=""
  FIXES=""
  CHORES=""
  OTHER=""

  while IFS= read -r line; do
    # Extract message (skip short hash) and type prefix
    msg="${line#* }"
    type=$(echo "$msg" | sed -E 's/^([a-zA-Z]+)(\([^)]*\))?:.*/\1/' | tr '[:upper:]' '[:lower:]')

    FORMATTED=$(format_line "$type" "$msg")
    case "$type" in
      feat|perf) FEATURES="${FEATURES}${FORMATTED}"$'\n' ;;
      fix)       FIXES="${FIXES}${FORMATTED}"$'\n' ;;
      chore|ci|build|docs|style|refactor|test) CHORES="${CHORES}${FORMATTED}"$'\n' ;;
      *)         OTHER="${OTHER}${FORMATTED}"$'\n' ;;
    esac
  done <<< "$CHANGELOG"

  echo "## Changelog"
  echo ""

  print_section "Features" "$FEATURES"
  print_section "Bug Fixes" "$FIXES"
  print_section "Maintenance" "$CHORES"
  print_section "Other Changes" "$OTHER"

  # Extract version from tag (e.g. js-sdk-v0.7.0 -> 0.7.0)
  VERSION=$(echo "$CURRENT_TAG" | sed -E 's/^[^-]+-[^-]+-v//')
  echo "**Package**: https://www.npmjs.com/package/braintrust/v/${VERSION}"
  echo ""
  echo "**Full Changelog**: ${REPO_URL}/compare/${PREVIOUS_TAG}...${CURRENT_TAG}"
fi
