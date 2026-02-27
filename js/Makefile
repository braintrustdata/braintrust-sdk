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
	@echo "  make test-ai-sdk        - Run AI SDK wrapper tests (v5 + v6)"
	@echo "  make test-ai-sdk-v5     - Run AI SDK v5 wrapper tests"
	@echo "  make test-ai-sdk-v6     - Run AI SDK v6 wrapper tests"
	@echo "  make test-claude-agent-sdk - Run Claude Agent SDK wrapper tests"
	@echo "  make test-vitest       - Run Vitest wrapper tests"
	@echo "  make test-api-compat    - Run API compatibility tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"
	@echo ""
	@echo "Smoke tests (mimics CI workflow):"
	@echo "  make test-smoke         - Run all smoke tests (auto-prepares)"
	@echo "  make test-smoke deno    - Run deno smoke test only"
	@echo "  make test-smoke span    - Run span smoke test only"
	@echo ""
	@echo "See smoke/README.md for details on smoke test infrastructure"

.PHONY: help bench build clean test test-core test-openai test-anthropic test-google-genai test-ai-sdk test-ai-sdk-v5 test-ai-sdk-v6 test-claude-agent-sdk test-vitest test-latest install-optional-deps publish-beta-local test-smoke

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

test-ai-sdk: test-ai-sdk-v5 test-ai-sdk-v6

test-ai-sdk-v5:
	cd src/wrappers/ai-sdk/tests/v5 && pnpm install --ignore-workspace && pnpm test

test-ai-sdk-v6:
	cd src/wrappers/ai-sdk/tests/v6 && pnpm install --ignore-workspace && pnpm test

# -------------------------------------------------------------------------------------------------
# Claude Agent SDK testing
# -------------------------------------------------------------------------------------------------

test-claude-agent-sdk:
	cd src/wrappers/claude-agent-sdk && pnpm install && pnpm test

# -------------------------------------------------------------------------------------------------
# Vitest testing
# -------------------------------------------------------------------------------------------------

test-vitest:
	cd src/wrappers/vitest && pnpm install && pnpm test

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
test: test-core test-openai test-anthropic test-google-genai test-ai-sdk test-vitest test-claude-agent-sdk

# Test the core and the latest versions of wrappers.
test-latest: test-core test-anthropic-latest test-openai-latest test-google-genai test-ai-sdk test-vitest test-claude-agent-sdk


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
	pnpm install
	pnpm run build
	pnpm publish --no-git-checks

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

SMOKE_DIR := smoke

# Run smoke tests - delegates to smoke/Makefile which handles auto-discovery and tarball creation
# Usage: make test-smoke [TEST_NAME...]
test-smoke:
	@cd $(SMOKE_DIR) && $(MAKE) test $(filter-out test-smoke,$(MAKECMDGOALS))

# Allow passing test names as make targets (they become no-ops)
cloudflare-worker deno nextjs-instrumentation otel-v1 span span-jest:
	@:
