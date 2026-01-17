# Cloudflare Vite + Hono Smoke Test

Tests Braintrust SDK in a Cloudflare Workers environment with Vite bundling and Hono routing.

## Design Decisions

**Tarball installation:** Uses well-known tarball path (`braintrust-latest.tgz`) to avoid package.json changes.

**Vite bundling:** Tests SDK through Vite's production bundler for Cloudflare Workers.

**Hono framework:** Uses Hono for elegant routing instead of raw Worker API.

**Browser build:** Uses `braintrust/browser` import since Cloudflare Workers don't support Node.js APIs.

**Wrangler testing:** Tests run via Wrangler dev server (Vite builds automatically via Cloudflare plugin).

**Expected failure handling:** Nunjucks templating is tested but expected to fail in browser builds. The test converts this failure to "xfail" (expected failure) status, so it doesn't cause the overall test run to fail. This ensures we always test both Mustache and Nunjucks, but handle known browser limitations gracefully.

**Test results:** 19 tests total - 18 pass + 1 xfail (Nunjucks). Overall test result: **PASS**.

**Why test Nunjucks if it fails?** Testing both template engines ensures:

- Mustache templating works correctly (browser-compatible)
- We detect if Nunjucks support changes in future Cloudflare Workers versions
- Consistent test coverage across all environments (Node.js scenarios pass both)
