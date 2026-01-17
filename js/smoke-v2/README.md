# Braintrust JS SDK Smoke Tests v2

Smoke test infrastructure for verifying SDK installation and basic functionality across different runtimes and integrations.

## Quick Reference

```bash
# Run all scenarios
make test

# Run specific scenario
make test otel-v1

# List available scenarios
make list
```

## Creating a New Scenario

### 1. Required Interfaces

Every scenario must implement these interfaces for auto-discovery:

**Makefile:**

```makefile
.PHONY: setup test

setup:
	# Install environment (mise, deno, etc.)
	# Build SDK artifacts if needed
	# Install dependencies

test: setup
	# Run your tests
```

**Environment specification:** mise.toml, deno.json, .nvmrc, etc.

**Dependency declaration:** package.json, deno.json, import_map.json, etc.

**Documentation:** README.md explaining design decisions (see below)

**Ignore patterns:** .gitignore (ignore artifacts, track lock files)

### README.md Guidelines

Keep scenario READMEs minimal and focused on **design decisions only**:

- Explain architectural choices (e.g., why use `links` vs tarballs)
- Document non-obvious patterns (e.g., why `--sloppy-imports` is needed)
- Skip usage instructions (that's what Makefile is for)
- Skip test descriptions (code should be self-documenting)

**Good examples:** `scenarios/deno-node/README.md`, `scenarios/deno-browser/README.md`, `scenarios/otel-v1/README.md`

Typical length: 15-25 lines

### 2. Choose Your Pattern

#### Pattern A: Node.js + npm

**When:** Testing Node.js environments, npm packages, or npm-based frameworks

**Example:** `scenarios/otel-v1/`, `scenarios/nextjs-instrumentation/`

**Key requirements:**

- Use well-known tarball paths in package.json (never change):
  ```json
  {
    "dependencies": {
      "braintrust": "file:../../../artifacts/braintrust-latest.tgz"
    }
  }
  ```
- Build artifacts BEFORE `npm install`
- Include all peer dependencies explicitly
- Never use `--legacy-peer-deps` (exposes real issues)

**Makefile template:**

```makefile
.PHONY: setup test

setup:
	@echo "==> Setting up my-scenario"
	mise install

	# Build SDK if braintrust-latest.tgz doesn't exist
	@if [ ! -f ../../../artifacts/braintrust-latest.tgz ]; then \
		cd ../../.. && pnpm build && npm pack --pack-destination artifacts; \
		for f in artifacts/braintrust-*.tgz; do \
			[ "$$(basename $$f)" = "braintrust-latest.tgz" ] && continue; \
			cp "$$f" artifacts/braintrust-latest.tgz; break; \
		done; \
	fi

	# Install dependencies (tarball paths in package.json)
	npm install

test: setup
	npx tsx tests/*.test.ts
```

**package.json:**

```json
{
  "name": "smoke-v2-my-scenario",
  "private": true,
  "type": "module",
  "dependencies": {
    "braintrust": "file:../../../artifacts/braintrust-latest.tgz"
    // Add other dependencies as needed
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4.19.2",
    "typescript": "^5"
  }
}
```

**mise.toml:**

```toml
[tools]
node = "22"
pnpm = "10.26.2"
```

#### Pattern B: Deno

**When:** Testing Deno runtime

**Example:** `scenarios/deno-node/`, `scenarios/deno-browser/`

**Key requirements:**

- Use `nodeModulesDir: "auto"` for npm package resolution
- Use `links` array to point to local workspace packages
- Use `npm:` specifiers in imports (e.g., `npm:braintrust@^2.0.2`)
- May need `--sloppy-imports` if dependencies use extensionless imports
- Track `deno.lock` for dependency resolution
- Never use `--no-check` (exposes real issues)

**Makefile template:**

```makefile
.PHONY: setup test

setup:
	@echo "==> Setting up deno-scenario"
	mise install

	# Build SDK (Deno will use dist/ directly via links)
	@if [ ! -d ../../../dist ]; then \
		cd ../../.. && pnpm build; \
	fi

	deno install

test: setup
	deno test --sloppy-imports --allow-all tests/*.test.ts
```

**deno.json:**

```json
{
  "imports": {
    "@std/assert": "jsr:@std/assert@^1.0.14",
    "braintrust": "npm:braintrust@^2.0.2"
  },
  "nodeModulesDir": "auto",
  "links": ["../../.."]
}
```

**mise.toml:**

```toml
[tools]
deno = "latest"
pnpm = "10.26.2"
```

### 3. Additional Packages (If Needed)

**If testing @braintrust/otel integration:**

Add to Makefile setup (BEFORE `npm install`):

```makefile
@if [ ! -f ../../../artifacts/braintrust-otel-latest.tgz ]; then \
	cd ../../../../integrations/otel-js && pnpm build && pnpm pack --pack-destination ../../js/artifacts; \
	for f in ../../js/artifacts/braintrust-otel-*.tgz; do \
		[ "$$(basename $$f)" = "braintrust-otel-latest.tgz" ] && continue; \
		cp "$$f" ../../js/artifacts/braintrust-otel-latest.tgz; break; \
	done; \
fi
```

Add to package.json:

```json
{
  "dependencies": {
    "@braintrust/otel": "file:../../../artifacts/braintrust-otel-latest.tgz",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/core": "^1.9.0",
    "@opentelemetry/sdk-trace-base": "^1.9.0"
    // Check sdk/integrations/otel-js/package.json peerDependencies for complete list
  }
}
```

**Note:** Use `pnpm pack` (not `npm pack`) for packages with `workspace:*` dependencies.

### 4. Test Implementation Guidelines

**Write realistic tests:**

- Use real SDKs, real APIs, real servers (no mocks)
- Test exactly as users would integrate
- Example: `otel-v1/` uses real HTTP server to capture OTLP exports

**Reduce duplication within scenario:**

- Create `src/` folder for scenario-specific helpers
- Example: `otel-v1/src/test-helpers.ts` provides `setupMockOtlpCollector()`

**Use shared utilities across scenarios:**

- Import from `../../shared` for cross-scenario helpers
- Example: Import verification tests, basic logging tests

## Design Principles

### Well-Known Tarball Paths

**Problem:** npm modifies package.json when installing file dependencies with version numbers.

**Solution:** Use version-agnostic paths copied by Makefile:

- `braintrust-latest.tgz` (never `braintrust-2.0.2.tgz`)
- `braintrust-otel-latest.tgz` (never `braintrust-otel-0.2.0.tgz`)

**Benefit:** package.json never changes regardless of version bumps.

### No Workarounds

**Never use:** `--legacy-peer-deps`, `--no-check`, `--ignore-errors`, mocks

**Why:** Smoke tests must expose issues users will encounter. If installation fails, fix the source package, not the test.

### Build Before Install

**Rule:** Build all artifacts BEFORE installing dependencies that reference them.

**Why:** Prevents "ENOENT: no such file or directory" errors.

### Track Lock Files

**Rule:** Commit `package-lock.json` and `deno.lock` to git.

**Why:** Lock files show what transitive dependencies users get. Changes signal:

- New dependencies introduced
- Version resolution conflicts
- Packaging issues

### Makefiles Are the Source of Truth

**Rule:** No npm scripts in package.json. All commands in Makefile.

**Why:** Single clear path to run tests. No confusion between `make test` vs `npm test`.

## Troubleshooting

### "ENOENT: no such file or directory" for tarball

**Cause:** Trying to install before building the package

**Fix:** Ensure Makefile builds packages BEFORE `npm install`

### "Unsupported URL Type 'workspace:'"

**Cause:** Used `npm pack` instead of `pnpm pack` for package with workspace dependencies

**Fix:** Use `pnpm pack` for packages like `@braintrust/otel`

### package.json gets modified by npm

**Cause:** Not using well-known tarball paths

**Fix:** Use `braintrust-latest.tgz` (not version-specific paths)

### Peer dependency conflicts

**Cause:** Incompatible or missing peer dependencies

**Fix:** Check package's `peerDependencies` and include all required versions. Do NOT use `--legacy-peer-deps`!

### Tests can't find braintrust imports

**Cause:** Tarball wasn't actually installed

**Fix:** Verify tarball paths in package.json are correct relative to scenario directory

## Directory Structure

```
smoke-v2/
├── shared/          # Cross-scenario test utilities
├── scenarios/       # Individual test scenarios
│   ├── otel-v1/
│   │   ├── src/           # Scenario-specific helpers
│   │   ├── tests/         # Test files
│   │   ├── Makefile       # setup + test targets
│   │   ├── mise.toml      # Environment definition
│   │   ├── package.json   # Dependencies only (no scripts)
│   │   └── README.md
│   └── nextjs-instrumentation/
├── Makefile         # Top-level orchestration (auto-discovery)
└── README.md        # This file
```

## How Auto-Discovery Works

The top-level Makefile finds scenarios:

```makefile
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print | sed 's|scenarios/||')
```

Any folder in `scenarios/` with a `Makefile` is automatically discovered. No registration needed.

## Reference Implementations

**Node.js + OTEL:** `scenarios/otel-v1/`

- Tests OpenTelemetry integration
- Shows tarball-based installation pattern
- Demonstrates scenario-specific helpers in `src/`
- Shows realistic HTTP server for capturing OTLP exports

**Deno + Local Linking:** `scenarios/deno-node/`, `scenarios/deno-browser/`

- Shows `nodeModulesDir: "auto"` + `links` pattern
- Demonstrates npm compatibility in Deno
- Shows when `--sloppy-imports` is needed
- Examples of Node vs Browser build testing

**Next.js + Multiple Runtimes:** `scenarios/nextjs-instrumentation/`

- Tests Edge and Node.js runtimes
- Shows build-time + runtime testing
- Demonstrates framework integration testing

## Migration from v1

Key improvements:

- ✅ Well-known tarball paths (no version bumps needed)
- ✅ No `--legacy-peer-deps` (exposes real issues)
- ✅ Makefiles as single source of truth
- ✅ Auto-discovery (no registration)
- ✅ Lock files tracked (catches packaging issues)
