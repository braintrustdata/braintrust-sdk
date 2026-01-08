# Default target
help:
	@echo "Braintrust JS SDK Makefile"
	@echo ""
	@echo "Available commands:"
	@echo "  make help                  - Show this help message"
	@echo "  make build                 - Build the SDK"
	@echo "  make clean                 - Clean build artifacts"
	@echo "  make install-optional-deps - Install optional dependencies"
	@echo "  make test               - Run all tests (core + wrappers + ai-sdk)"
	@echo "  make test-core          - Run core tests only"
	@echo "  make test-openai        - Run OpenAI wrapper tests"
	@echo "  make test-anthropic     - Run Anthropic wrapper tests"
	@echo "  make test-google-genai  - Run Google GenAI wrapper tests"
	@echo "  make test-ai-sdk        - Run AI SDK wrapper tests"
	@echo "  make test-claude-agent-sdk - Run Claude Agent SDK wrapper tests"
	@echo "  make test-api-compat    - Run API compatibility tests"
	@echo "  make test-smoke         - Run smoke tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"

.PHONY: help bench build clean test test-core test-openai test-anthropic test-google-genai test-ai-sdk test-claude-agent-sdk test-latest install-optional-deps publish-beta-local test-smoke

# -------------------------------------------------------------------------------------------------	#
# Anthropic testing
# -------------------------------------------------------------------------------------------------

test-anthropic: test-anthropic-latest test-anthropic-0.39.0 test-anthropic-0.38.0

test-anthropic-latest:
	pnpm prune
	$(call pnpm_install_no_save,@anthropic-ai/sdk)
	pnpm test:anthropic

test-anthropic-%:
	pnpm prune
	$(call pnpm_install_no_save,@anthropic-ai/sdk@$*)
	pnpm test:anthropic

# ----
# Google GenAI
# ----
test-google-genai: test-google-genai-latest

test-google-genai-latest:
	pnpm prune
	$(call pnpm_install_no_save,@google/genai)
	pnpm test:google-genai

# -------------------------------------------------------------------------------------------------
# AI SDK testing
# -------------------------------------------------------------------------------------------------

test-ai-sdk:
	cd src/wrappers/ai-sdk && pnpm install && pnpm test

# -------------------------------------------------------------------------------------------------
# Claude Agent SDK testing
# -------------------------------------------------------------------------------------------------

test-claude-agent-sdk:
	cd src/wrappers/claude-agent-sdk && pnpm install && pnpm test


# -------------------------------------------------------------------------------------------------
# OpenAI testing
# -------------------------------------------------------------------------------------------------

.PHONY: test-openai test-openai-latest test-openai-%

test-openai: test-openai-latest test-openai-4.92.1 test-openai-4.91.0 test-openai-4.86.0
test-openai-latest:
	pnpm prune
	$(call pnpm_install_no_save,openai)
	pnpm test:openai

test-openai-%:
	pnpm prune
	$(call pnpm_install_no_save,openai@$*)
	pnpm test:openai


# -------------------------------------------------------------------------------------------------
# common things
# -------------------------------------------------------------------------------------------------

.PHONY: test-pnpm test test-latest prune installing-optional-deps docs build verify-ci bench test-api-compat

install-optional-deps:
	npm_config_save=false npm_config_lockfile=false pnpm add \
		"openai" \
		"@anthropic-ai/sdk"


# Test everything but the wrappers.
test-core:
	pnpm prune
	pnpm test

# Test API compatibility
test-api-compat:
	pnpm test:api-compat

# Test everything
test: test-core test-openai test-anthropic test-google-genai

# Test the core and the latest versions of wrappers.
test-latest: test-core test-anthropic-latest test-openai-latest test-google-genai


prune:
	pnpm prune

docs:
	pnpm run docs

build:
	npm run build

publish-beta-local: build
	pnpm publish --tag beta

bench:
	npx tsx src/queue.bench.ts


# note: we don't use the docs in ci, but this makes sure they keep building

verify-ci: build docs test

publish-sdk-js:
	./scripts/validate-release.sh
	npm install
	npm run build
	npm publish

# This is the only method I could find to install a package without explicitly
# adding a dependency or modifying lock files.
define pnpm_install_no_save
	@echo "No save installing "$(1)""
	npm_config_save=false npm_config_lockfile=false pnpm add "$(1)"
endef

clean:
	npm run clean

# -------------------------------------------------------------------------------------------------
# Smoke tests
# -------------------------------------------------------------------------------------------------

# Marker file to track when smoke tests were last prepared
SMOKE_PREPARE_MARKER := smoke/.prepare-marker
SMOKE_DIR := smoke

# Run smoke tests (prepares if source changed)
# Usage: make test-smoke [TEST_NAME...]
test-smoke:
	@if [ ! -f "$(SMOKE_PREPARE_MARKER)" ]; then \
		echo "⚠ Smoke tests not prepared, preparing..."; \
		cd $(SMOKE_DIR) && ./prepare-tests.sh && touch .prepare-marker; \
	elif [ -n "$$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) -newer "$(SMOKE_PREPARE_MARKER)" 2>/dev/null | head -1)" ]; then \
		echo "⚠ SDK source files changed, preparing smoke tests..."; \
		cd $(SMOKE_DIR) && ./prepare-tests.sh && touch .prepare-marker; \
	elif [ -n "$$(find dist -type f -name '*.js' -newer "$(SMOKE_PREPARE_MARKER)" 2>/dev/null | head -1)" ]; then \
		echo "⚠ SDK build artifacts changed, preparing smoke tests..."; \
		cd $(SMOKE_DIR) && ./prepare-tests.sh && touch .prepare-marker; \
	elif [ ! -d "artifacts" ] || [ -z "$$(ls artifacts/*.tgz 2>/dev/null | head -1)" ]; then \
		echo "⚠ Smoke test artifacts missing, preparing..."; \
		cd $(SMOKE_DIR) && ./prepare-tests.sh && touch .prepare-marker; \
	else \
		echo "✓ Smoke tests are up to date"; \
	fi
	@echo "Running smoke tests..."
	@EXIT_CODE=0; \
	cd $(SMOKE_DIR) && ./run-tests.sh $(filter-out test-smoke,$(MAKECMDGOALS)) || EXIT_CODE=$$?; \
	echo ""; \
	echo "Restoring package files..."; \
	for dir in tests/*/; do \
		if [ -f "$$dir/package.json" ] && grep -q '"restore"' "$$dir/package.json" 2>/dev/null; then \
			(cd "$$dir" && npm run restore >/dev/null 2>&1 && echo "  ✓ Restored $$(basename $$dir)") || true; \
		fi; \
	done; \
	exit $$EXIT_CODE

# Allow passing test names as make targets (they become no-ops)
cloudflare-worker deno nextjs-instrumentation otel-v1 span span-jest:
	@:
