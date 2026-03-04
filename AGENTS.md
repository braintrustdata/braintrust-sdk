# Braintrust JavaScript SDK Monorepo

JavaScript/TypeScript SDKs and integrations for Braintrust.

This repository uses `pnpm` workspaces and `mise` for tool management.
`AGENTS.md` is the canonical agent instructions file; `CLAUDE.md` is a compatibility symlink.

## Repository Structure

```text
.
├── js/             # Main `braintrust` package
├── integrations/   # Integration packages (@braintrust/*)
├── docs/           # Docs and reference material
└── internal/       # Internal test fixtures and golden projects
```

## Setup

```bash
mise install        # Install toolchain from mise.toml + .tool-versions
pnpm install        # Install workspace dependencies
```

## Common Commands (repo root)

```bash
pnpm run build      # Build all workspace packages
pnpm run test       # Run workspace tests (via turbo)
pnpm run lint       # Prettier + ESLint checks
pnpm run fix        # Auto-fix Prettier + ESLint
make test           # Full JS-oriented test flow used in this repo
```

## JavaScript SDK (`js/`)

Run package-scoped commands from `js/` unless noted otherwise.

```bash
make test                    # Full JS test suite (core + wrappers)
pnpm test -- -t "test name"  # Filter within core vitest suite
pnpm build                   # Build js package
```

## Linting & Formatting

From repository root:

```bash
pnpm run lint
pnpm run fix
pnpm run lint:prettier
pnpm run lint:eslint
pnpm run fix:prettier
pnpm run fix:eslint
```

Always run formatting before committing to avoid hook failures:

```bash
pnpm run fix:prettier
```

## Test Framework

Uses Vitest. Most tests are local/mocked; some wrapper tests require real API keys.

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

## dotagents

Use `dotagents` (managed by `mise`) for reproducible, cross-agent skill configuration.

```bash
dotagents init
dotagents install
```

For CI or strict reproducibility, use:

```bash
dotagents install --frozen
```
