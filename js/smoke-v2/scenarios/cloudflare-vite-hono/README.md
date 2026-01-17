# Cloudflare Vite + Hono Smoke Test

Tests Braintrust SDK in a Cloudflare Workers environment with Vite bundling and Hono routing.

## Design Decisions

**Tarball installation:** Uses well-known tarball path (`braintrust-latest.tgz`) to avoid package.json changes.

**Vite bundling:** Tests SDK through Vite's production bundler for Cloudflare Workers.

**Hono framework:** Uses Hono for elegant routing instead of raw Worker API.

**Browser build:** Uses `braintrust/browser` import since Cloudflare Workers don't support Node.js APIs.

**Two-test approach:** Runs both Wrangler (production mode) and Vite dev server tests to validate different deployment scenarios.

## Test Suite

### Test 1: Wrangler (Production Mode) - `tests/worker.test.mjs`

Tests the SDK via Wrangler dev server, which uses Vite to build the worker.

**Expected results:** 19 tests total - 18 pass + 1 xfail (Nunjucks). Overall: **PASS**.

**Expected failure handling:** Nunjucks templating is tested but expected to fail in browser builds. The test converts this failure to "xfail" (expected failure) status, so it doesn't cause the overall test run to fail.

**Why test Nunjucks if it fails?** Testing both template engines ensures:

- Mustache templating works correctly (browser-compatible)
- We detect if Nunjucks support changes in future Cloudflare Workers versions
- Consistent test coverage across all environments (Node.js scenarios pass both)

### Test 2: Vite Dev Server - `tests/vite-dev.test.mjs`

Tests whether the SDK can be loaded in Vite's dev server (with hot module reloading).

**Expected result:** FAIL (expected to fail) - Vite's dependency pre-bundler cannot handle Nunjucks.

**Known issue:** Nunjucks uses `Object.setPrototypeOf` in ways that fail in Vite's ESM bundler during dependency pre-bundling, causing: `TypeError: Object prototype may only be an Object or null: undefined`

**This failure is expected and acceptable** - users should use Wrangler (production mode) for Cloudflare Workers development, not Vite dev server. The Wrangler test validates the production deployment path.

**Note:** If you see a different error (not the Nunjucks error), that's unexpected and should be investigated.

## Running Tests

```bash
make test  # Runs both tests sequentially
```

**Success criteria:** The Wrangler test must pass. The Vite dev test is expected to fail (exit code 1) and won't cause the overall `make test` to fail.
