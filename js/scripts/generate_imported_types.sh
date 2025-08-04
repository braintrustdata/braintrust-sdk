#!/usr/bin/env bash

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Get the SDK JS directory (parent of scripts directory)
SDK_JS_DIR="${SCRIPT_DIR}/.."

# Change to the SDK JS directory to ensure npx uses the correct node_modules
cd "${SDK_JS_DIR}"

# Run the openapi-zod-client command
npx openapi-zod-client \
  "../imported_types.json" \
  --export-schemas \
  --export-types \
  --additional-props-default-value false \
  --template "./scripts/openapi_zod_client_output_template.hbs" \
  -o "./src/imported_types.ts"
