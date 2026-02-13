# Cloudflare Vite + Hono Vite Dev Server Test (Node ESM Build)

Tests whether the Braintrust SDK (Node.js ESM build) can be loaded in Vite's dev server.

## Design Decisions

**Tarball installation:** Uses well-known tarball path (`braintrust-latest.tgz`) to avoid package.json changes.

**Vite dev server:** Tests SDK through Vite's development server.

**Hono framework:** Uses Hono for elegant routing instead of raw Worker API.

**Node ESM build:** Uses `braintrust/node` import to test Node.js ESM build resolution.

**nodejs_compat_v2:** Enables Node.js API compatibility in Cloudflare Workers runtime.

## Test Suite

Tests whether the SDK's Node.js ESM build can be loaded in Vite's dev server.

**Expected result:** XFAIL (expected to fail) - Vite cannot load the Node.js ESM build.

**Known issues:**

- Nunjucks uses `Object.setPrototypeOf` in ways that fail in Vite's ESM bundler during dependency pre-bundling, causing: `TypeError: Object prototype may only be an Object or null: undefined`

**This failure is expected and acceptable** - users should use Wrangler (production mode) for Cloudflare Workers development with the Node.js build, not Vite dev server. The wrangler-dev test validates the production deployment path.

**Note:** If you see a different error (not the Nunjucks error), that's unexpected and should be investigated.

## Running Tests

```bash
make test  # Runs the vite dev node esm test
```

**Success criteria:** The test should produce an expected failure (xfail) for Nunjucks incompatibility. The test itself should not fail (exit code 0).
