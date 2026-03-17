#!/usr/bin/env bash
#
# Run a provider wrapper test, optionally installing a specific package version first.
#
# Usage:
#   ./scripts/test-provider.sh <test-script> [package@version]
#
# Examples:
#   ./scripts/test-provider.sh test:openai                    # uses whatever is installed
#   ./scripts/test-provider.sh test:openai openai             # installs latest openai
#   ./scripts/test-provider.sh test:openai openai@4.92.1      # installs openai@4.92.1
#   ./scripts/test-provider.sh test:anthropic @anthropic-ai/sdk@0.39.0
#
set -euo pipefail

SCRIPT="${1:?Usage: test-provider.sh <test-script> [package@version]}"
PACKAGE="${2:-}"

pnpm prune

if [ -n "$PACKAGE" ]; then
  echo "Installing $PACKAGE (no-save)..."
  npm_config_save=false npm_config_lockfile=false pnpm add "$PACKAGE"
fi

pnpm run "$SCRIPT"
