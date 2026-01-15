# Braintrust Vite + React + Hono Smoke Test

Smoke test for the Braintrust SDK in a Vite + React + Hono + Cloudflare Workers environment.

This test demonstrates:

- Using Braintrust SDK with Hono routing framework
- Running shared test suites in a Cloudflare Worker
- Integration with Vite for both frontend and backend
- React frontend that can trigger smoke tests

Based on the [Cloudflare Vite + React + Hono template](https://github.com/cloudflare/templates/tree/main/vite-react-template).

📚 **See [TESTING.md](./TESTING.md) for detailed testing guide and issue documentation.**

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

# Test Vite dev server compatibility (documents known issue)
npm run test:vite-dev

# Build for production
npm run build
```

### Known Issue: Vite Dev Server

**⚠️ The Vite dev server (`npm run dev`) currently fails** with the following error:

```
TypeError: Object prototype may only be an Object or null: undefined
    at _inheritsLoose (node_modules/nunjucks/src/object.js:8:77)
```

**Root Cause**: When Vite tries to pre-bundle dependencies, it encounters Nunjucks (used by Braintrust for prompt templating). Nunjucks uses `Object.setPrototypeOf` with potentially undefined values, which fails in Vite's ESM bundler.

**Workarounds**:

1. Use `braintrust/browser` import instead of full `braintrust` package
2. Configure Vite to exclude Nunjucks from optimization:
   ```js
   // vite.config.ts
   export default defineConfig({
     optimizeDeps: {
       exclude: ["nunjucks"],
     },
   });
   ```

**Testing**: Run `npm run test:vite-dev` to verify this known issue is reproducible. The test will fail (exit code 1), which is expected. CI is configured to allow this failure.

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
2. **Vite Bundling**: Tests the Braintrust SDK through Vite's bundler (production mode)
3. **Compatibility Testing**: Documents and tests Vite dev server limitations
4. **Cloudflare Workers**: Tests in actual Workers runtime environment
5. **Shared Test Suites**: Consistent test coverage across all environments

## Test Coverage

This smoke test suite includes:

### 1. Production Worker Test (`npm test`)

Tests the Braintrust SDK in a production-like Cloudflare Workers environment:

- ✅ 18/19 tests pass
- ✅ All import verification tests
- ✅ All functional logging tests
- ✅ Eval smoke test
- ✅ Mustache prompt templating
- ❌ Nunjucks templating (expected failure - Cloudflare security policy)

### 2. Vite Dev Server Compatibility Test (`npm run test:vite-dev`)

Documents a known limitation with Vite's dev server:

- ❌ Reproduces the Nunjucks bundling issue (exits with code 1)
- ✅ Provides clear error messages and workarounds
- ✅ Helps verify if the issue persists in new versions

This test **reports honest failures**. CI is configured with `continue-on-error: true` to allow this expected failure without blocking the build.

## Notes

- The automated test (`npm test`) only exercises the `/api/test` endpoint via Wrangler
- The React frontend is optional and not used in CI
- Tests run in Cloudflare Workers environment (V8 isolates)
- Uses Wrangler dev server for local testing (not Vite)
- Port 8800 is used to avoid conflicts with other smoke tests
- The Vite dev server issue is documented and testable but not blocking
