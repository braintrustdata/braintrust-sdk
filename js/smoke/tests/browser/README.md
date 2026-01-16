# Braintrust SDK Browser Smoke Tests

This package contains smoke tests for the Braintrust SDK running in a browser environment using Playwright.

## What It Tests

The browser tests run **all shared test suites** from `sdk/js/smoke/shared` to ensure full SDK compatibility in the browser.

## Prerequisites

- Node.js (v18+)
- npm

## Setup

```bash
npm install
```

This will automatically install Playwright browsers via the `postinstall` script.

## Running Tests

### Run all tests (builds automatically)

```bash
npm test
```

This will:

1. Build the test bundle using esbuild
2. Start a local web server
3. Run Playwright tests

### Build only

```bash
npm run build
```

### Run tests without rebuilding

```bash
npx playwright test
```

## How It Works

1. **Build Step**: `esbuild` bundles `src/browser-tests.ts` (which includes the Braintrust SDK and shared test suites) into `dist/browser-tests.js`
2. **Web Server**: Playwright's `webServer` starts `http-server` to serve the test files
3. **Test Execution**: Playwright loads `pages/browser-tests.html` which loads the bundled test script
4. **Test Results**: Tests communicate results via `window.testResults` and `window.evalTestResults` which Playwright reads

## Test Environment

- Uses `_exportsForTestingOnly.useTestBackgroundLogger()` to prevent real API calls
- Uses `noSendLogs: true` in Eval to prevent experiment registration
- All tests run locally without network requests to Braintrust API

## Project Structure

```
browser/
├── src/
│   └── browser-tests.ts      # Combined test file (general + eval)
├── tests/
│   └── browser.test.ts       # Playwright test runner
├── pages/
│   └── browser-tests.html    # HTML page that loads tests
├── dist/                      # Built test bundle (gitignored)
├── playwright.config.ts       # Playwright configuration
├── esbuild.config.js          # Build configuration
└── package.json
```

## CI Integration

The tests are designed to run in CI environments:

- Automatically builds before running tests
- Uses test background logger (no real API calls)
- Retries on failure in CI mode
- Generates HTML reports
