# Braintrust Vite + React + Hono Smoke Test

Smoke test for the Braintrust SDK in a Vite + React + Hono + Cloudflare Workers environment.

This test demonstrates:

- Using Braintrust SDK with Hono routing framework
- Running shared test suites in a Cloudflare Worker
- Integration with Vite for both frontend and backend
- React frontend that can trigger smoke tests

Based on the [Cloudflare Vite + React + Hono template](https://github.com/cloudflare/templates/tree/main/vite-react-template).

## Architecture

- **Backend**: Hono app running in Cloudflare Worker (`src/worker/index.ts`)
- **Frontend**: React app built with Vite (`src/react-app/`)
- **Tests**: Shared test suites from `../../shared/`
- **Bundler**: Vite with Cloudflare plugin
- **Framework**: Hono for routing

## Project Structure

```
vite-react-hono/
├── src/
│   ├── worker/
│   │   └── index.ts          # Hono worker with test endpoints
│   └── react-app/
│       ├── App.tsx            # React app with test UI
│       ├── main.tsx           # React entry point
│       └── *.css              # Styles
├── index.html                 # HTML entry point
├── vite.config.ts            # Vite configuration
├── wrangler.json             # Cloudflare Workers config
├── tsconfig.json             # TypeScript config (worker)
├── tsconfig.app.json         # TypeScript config (React)
├── tsconfig.worker.json      # TypeScript config (worker)
└── run-test.mjs              # Test runner script
```

## Running the Test

```bash
# Install dependencies
npm install

# Run the automated smoke test (CI mode)
npm test

# Or run in development mode with React UI
npm run dev
# Then visit http://localhost:5173

# Build for production
npm run build
```

## Test Endpoints

When running (`npm run dev` or via `wrangler dev`):

- `GET /` - Home page with test information (text response)
- `GET /api/` - Basic API endpoint returning JSON
- `GET /api/test` - Run shared test suites (returns JSON test results)

## What's Tested

This smoke test runs the full shared test suite:

1. **Import Verification Tests** (~13 tests)

   - All Braintrust exports are accessible
   - Core logging, Dataset, Prompt, Experiment, Eval exports
   - Tracing, client wrappers, utilities

2. **Functional Tests** (~3 tests)

   - Basic span logging
   - Multiple sequential spans
   - Direct logging operations

3. **Eval Smoke Test** (1 test)

   - Evaluation functionality works

4. **Prompt Templating Tests** (~2 tests)
   - Prompt template rendering

All tests use the shared test suite package for consistency across environments.

## Development

### Running with React Frontend (Optional)

The React frontend provides a UI to trigger the smoke tests manually. To use it:

1. Build the frontend: `npm run build`
2. Update `wrangler.json` to add assets configuration:
   ```json
   "assets": {
     "directory": "./dist/client",
     "not_found_handling": "single-page-application"
   }
   ```
3. Start dev server: `npm run dev`
4. Visit http://localhost:5173
5. Click "Run Smoke Tests" button

**Note**: The automated smoke test (`npm test`) only needs the worker API endpoints and doesn't require building the React frontend.

## CI Integration

This test is automatically discovered and run by `../../run-tests.sh`:

```bash
cd ../../
./run-tests.sh vite-react-hono
```

The test runs in CI alongside other smoke tests:

- Builds the SDK from source
- Installs the build artifact
- Runs the test via HTTP endpoint
- Verifies all shared test suites pass

## Key Features

1. **Hono Integration**: Uses Hono's elegant routing instead of raw Worker API
2. **Vite Bundling**: Tests the Braintrust SDK through Vite's bundler
3. **React Frontend**: Optional UI for manual testing
4. **Cloudflare Workers**: Tests in actual Workers runtime environment
5. **Shared Test Suites**: Consistent test coverage across all environments

## Notes

- The automated test (`npm test`) only exercises the `/api/test` endpoint
- The React frontend is optional and not tested in CI
- Tests run in Cloudflare Workers environment (V8 isolates)
- Uses Wrangler dev server for local testing
- Port 8800 is used to avoid conflicts with other smoke tests
