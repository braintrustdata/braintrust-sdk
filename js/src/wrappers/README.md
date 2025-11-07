# Braintrust SDK Wrappers

This directory contains wrappers for various AI frameworks and SDKs. All wrappers are **exported from the main `braintrust` package** and ship as part of the regular npm distribution.

## Directory Structure

### Standard Wrappers

Most wrappers are single files that live directly in this directory:

- `anthropic.ts` - Anthropic SDK wrapper
- `oai.ts` - OpenAI SDK wrapper
- `google-genai.ts` - Google GenAI wrapper
- etc.

### Isolated Test Wrappers

Some wrappers have their own subdirectories with `package.json` files:

- `ai-sdk` - AI SDK wrapper
- `mastra/` - Mastra agent wrapper
- `claude-agent-sdk/` - Claude Agent SDK wrapper

**Important**: These subdirectories contain **private test-only packages** (`"private": true`). The code is still exported from the main `braintrust` package - the separate `package.json` files exist solely to run tests with specific dependency versions.

## Why Separate package.json Files?

Some integrations need to be tested against specific versions of their underlying SDKs:

- **AI SDK v4 vs v5**: Breaking changes between major versions require separate test environments
- **Mastra**: Uses AI SDK v5 and has specific version requirements
- **Claude Agent SDK**: Has its own versioning independent of Anthropic's main SDK

### What Gets Published?

**Everything in this directory ships in the main `braintrust` npm package.** The subdirectory `package.json` files are marked `"private": true` and are **never published to npm**.

Users install just one package:

```bash
npm install braintrust
```

And can import any wrapper:

```typescript
import { wrapAISDK, wrapMastraAgent, wrapClaudeAgentSDK } from "braintrust";
```

### Running Tests

**Main package tests:**

```bash
cd js
pnpm test  # Excludes subdirectory tests
```

**Subdirectory tests** (with isolated dependencies):

```bash
cd js/src/wrappers/ai-sdk && pnpm test
cd js/src/wrappers/mastra && pnpm test
cd js/src/wrappers/claude-agent-sdk && pnpm test
```

## Adding a New Wrapper

### For Standard Wrappers (Single File)

1. Create `your-wrapper.ts` in this directory
2. Create `your-wrapper.test.ts` for tests
3. Export from `src/exports-node.ts`:
   ```typescript
   export { wrapYourSDK } from "./wrappers/your-wrapper";
   ```
4. Add test exclusion to main `package.json` if needed

### For Isolated Test Wrappers (Separate package.json)

Only needed if you require specific SDK versions for testing:

1. Create subdirectory: `js/src/wrappers/your-wrapper/`
2. Move files: `your-wrapper.ts`, `your-wrapper.test.ts`
3. Create `package.json` (marked `"private": true`) with specific dependencies
4. Create `vitest.config.js` and `tsconfig.json` (copy from `ai-sdk-4/`)
5. Fix imports to use relative paths (`../../logger`, etc.)
6. Update `src/exports-node.ts`:
   ```typescript
   export { wrapYourSDK } from "./wrappers/your-wrapper/your-wrapper";
   ```
7. Run `pnpm install` in the subdirectory

## GitHub Actions

All wrapper subdirectories with their own `package.json` are tested automatically in CI via a single workflow file: `.github/workflows/reusable-test-sdk-wrappers.yaml`

### How It Works

The workflow uses a **matrix strategy** to test all wrappers in parallel:

```yaml
strategy:
  fail-fast: false
  matrix:
    wrapper:
      - ai-sdk
      - mastra
      - claude-agent-sdk
```

Each wrapper gets its own job that:

1. Checks out the repository
2. Sets up Node.js and pnpm
3. Installs dependencies in the wrapper's subdirectory
4. Runs `pnpm test` with the isolated dependencies

### Adding a New Wrapper to CI

When adding a new isolated test wrapper:

1. Follow the steps in "Adding a New Wrapper" above
2. Add the wrapper directory name to the matrix in `.github/workflows/reusable-test-sdk-wrappers.yaml`:
   ```yaml
   matrix:
     wrapper:
       - ai-sdk
       - mastra
       - claude-agent-sdk
       - your-new-wrapper # Add here
   ```

The workflow is integrated into the main CI pipeline (`.github/workflows/braintrust-ci.yaml`) and runs automatically on pull requests.
