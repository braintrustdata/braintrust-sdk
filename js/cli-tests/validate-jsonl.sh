#!/bin/bash
# Validates JSONL output from braintrust eval command
# Usage: braintrust eval file.ts --jsonl | ./validate-jsonl.sh

set -euo pipefail

# Collect all lines
OUTPUT=$(cat)

# Check if output is empty
if [ -z "$OUTPUT" ]; then
    echo "❌ No output from eval command" >&2
    exit 1
fi

# Check for compilation errors (these appear before JSONL)
if echo "$OUTPUT" | grep -q "ERROR.*Top-level await\|Build failed\|Failed to compile"; then
    echo "❌ Compilation failed" >&2
    echo "$OUTPUT" >&2
    exit 1
fi

# Parse JSONL to check if evaluators ran
# Each line should be a valid JSON object with experimentName
LINE_COUNT=0
SUCCESS=true

while IFS= read -r line; do
    # Skip empty lines
    if [ -z "$line" ]; then
        continue
    fi

    # Check if line is valid JSON
    if ! echo "$line" | jq -e . >/dev/null 2>&1; then
        # Not JSON, might be error message
        continue
    fi

    LINE_COUNT=$((LINE_COUNT + 1))

    # Check if this is a summary with experimentName
    EXPERIMENT_NAME=$(echo "$line" | jq -r '.experimentName // empty')
    if [ -n "$EXPERIMENT_NAME" ]; then
        echo "✓ Ran evaluator: $EXPERIMENT_NAME" >&2
    fi
done <<< "$OUTPUT"

if [ $LINE_COUNT -eq 0 ]; then
    echo "❌ No evaluators ran (no JSONL output)" >&2
    echo "$OUTPUT" >&2
    exit 1
fi

echo "✓ $LINE_COUNT evaluator(s) completed successfully" >&2
exit 0
