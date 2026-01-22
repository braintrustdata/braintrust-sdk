# Deno Node Build Test

Tests the main Node.js-compatible build (`braintrust` package) in Deno runtime.

## Design Decisions

### Local Package Linking

Uses Deno's `links` feature in `deno.json` to test against local SDK builds:

- `"links": ["../../..", "../../shared"]` ensures we use the workspace versions
- No need to publish or pack - Deno reads from `../../../dist/` directly

### Sloppy Imports

Requires `--sloppy-imports` flag because the shared test package uses extensionless imports:

- Shared package: `import { foo } from "./helpers/types"` (no `.ts`)
- This is standard for TypeScript/Node.js but requires `--sloppy-imports` in Deno
- Alternative would be adding `.ts` extensions, but that may break Node.js tooling

### npm Compatibility

Uses `nodeModulesDir: "auto"` to enable Deno's npm package resolution:

- Allows `npm:braintrust@^2.0.2` imports
- Combined with `links`, resolves to local workspace packages
