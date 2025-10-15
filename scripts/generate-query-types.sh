#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Generating BTQL query types from btql_schema.json..."

# Generate Python TypedDict types
echo "Generating Python types..."
datamodel-codegen \
  --input js/btql_schema.json \
  --output py/src/braintrust/btql/btql_types.py \
  --input-file-type jsonschema \
  --use-standard-collections \
  --use-union-operator \
  --output-model-type typing.TypedDict

# Fix forward reference issues in functional TypedDict definitions
echo "Fixing forward references in Python types..."
python3 scripts/fix_python_forward_refs.py py/src/braintrust/btql/btql_types.py

# Generate TypeScript Zod schemas
echo "Generating TypeScript runtime schema..."
cd js
cat btql_schema.json | npx json-schema-to-zod > src/btql/btql-schema.ts

echo "Generating TypeScript type definitions..."
cd ..
python3 scripts/build_btql_types.py

echo "✓ Generated types successfully"
