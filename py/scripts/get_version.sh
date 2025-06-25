#!/bin/bash
# Script to extract and print the version number from version.py


ROOT_DIR=$(git rev-parse --show-toplevel)

VERSION_FILE="$ROOT_DIR/py/src/braintrust/version.py"

# Extract the version using grep and cut
VERSION=$(grep -E '^VERSION\s*=' "$VERSION_FILE" | grep -o '".*"' | tr -d '"')

# Print the version
echo "$VERSION"
