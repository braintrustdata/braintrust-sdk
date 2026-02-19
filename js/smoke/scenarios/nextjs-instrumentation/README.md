# Next.js Instrumentation Scenario

Tests Braintrust SDK integration in Next.js with multiple runtimes.

## Design Decisions

### Tarball Installation

Uses `file:` dependencies pointing to pre-built tarballs:

- `"braintrust": "file:../../../artifacts/braintrust-latest.tgz"`
- `"@braintrust/otel": "file:../../../artifacts/braintrust-otel-latest.tgz"`
- More realistic test of how Next.js bundles published packages
- Catches webpack bundling issues that local linking might miss

### Build + Runtime Testing

Tests at two stages:

1. **Build-time** (`npx next build`) - Catches static issues (imports, exports, bundling)
2. **Runtime** (dev server + HTTP requests) - Catches execution issues in both runtimes

Both needed because Next.js can build successfully but fail at runtime, or vice versa.

### Multiple Runtime Testing

Tests both Next.js runtimes in separate API routes:

- **Edge Runtime** (`/api/smoke-test/edge`) - V8 isolates, no Node.js APIs (like Cloudflare Workers)
- **Node.js Runtime** (`/api/smoke-test/node`) - Full Node.js environment

Different runtimes have different capabilities - Edge can't use nunjucks, filesystem, etc.

### Shared Package Import

Uses long relative path to shared package:

- `from "../../../../../../../shared/dist/index.mjs"`
- Next.js webpack handles this correctly despite the deep nesting
- Alternative would be adding shared to dependencies, but relative import is simpler
