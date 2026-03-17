# Braintrust JavaScript SDK Monorepo

JavaScript/TypeScript SDKs and integrations for Braintrust.

This repository uses `pnpm` workspaces.

## Repository Structure

```text
.
├── js/             # Main `braintrust` package (see js/CLAUDE.md)
├── integrations/   # Integration packages (@braintrust/*)
├── docs/           # Docs and reference material
└── internal/       # Internal test fixtures and golden projects
```

## Common Commands (repo root)

```bash
pnpm install        # Install dependencies
pnpm run build      # Build all workspace packages
pnpm run test       # Run workspace tests (via turbo)
pnpm run formatting # Check formatting
pnpm run lint       # Run lint checks
pnpm run fix:formatting # Auto-fix formatting
pnpm run fix:lint   # Auto-fix lint issues
```
