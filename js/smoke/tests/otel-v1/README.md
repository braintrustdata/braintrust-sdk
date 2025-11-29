# Running the OTEL v1 Integration Test Locally

## Prerequisites

1. Build and pack `braintrust`:

   ```bash
   cd js
   npm run build
   mkdir -p artifacts
   npm pack --pack-destination artifacts
   ```

2. Build and pack `@braintrust/otel`:
   ```bash
   cd ../../integrations/otel-js
   npm run build
   npm pack --pack-destination ../../js/artifacts
   ```

## Running the Test

1. Navigate to the test directory:

   ```bash
   cd js/smoke/tests/otel-v1
   ```

2. Install dependencies and local packages:

   ```bash
   npm run install-build
   ```

   This will:

   - Install regular dependencies
   - Install `braintrust` from `js/artifacts/`
   - Install `@braintrust/otel` from `js/artifacts/` (or build it if not found)

3. Run the test:
   ```bash
   npm start
   ```

## Troubleshooting

- If you get "Cannot find module '@braintrust/otel'", make sure you ran `npm run install-build` first
- If artifacts directory is empty, make sure you built and packed both packages (see Prerequisites)
- The `install-build` script will automatically build `@braintrust/otel` if it's not in artifacts
