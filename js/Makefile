# Default target
help:
	@echo "Braintrust JS SDK Makefile"
	@echo ""
	@echo "Available commands:"
	@echo "  make help                - Show this help message"
	@echo "  make build              - Build the SDK"
	@echo "  make clean              - Clean build artifacts"
	@echo "  make install-optional-deps - Install optional dependencies"
	@echo "  make test               - Run all tests (core + wrappers + ai-sdk)"
	@echo "  make test-core          - Run core tests only"
	@echo "  make test-ai-sdk        - Run AI SDK tests (v1 + v2)"
	@echo "  make test-otel          - Run OpenTelemetry tests (both installed and missing)"
	@echo "  make test-otel-installed - Run OpenTelemetry tests with library installed"
	@echo "  make test-otel-missing  - Run OpenTelemetry tests without library"
	@echo "  make test-openai        - Run OpenAI wrapper tests"
	@echo "  make test-anthropic     - Run Anthropic wrapper tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"
	@echo ""
	@echo "Pre-release publishing:"
	@echo "  make publish-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>"
	@echo "  Examples:"
	@echo "    make publish-prerelease MODE=local TYPE=beta BUMP=prerelease   - Publish locally"
	@echo "    make publish-prerelease MODE=gh TYPE=alpha BUMP=prepatch       - Trigger GitHub Actions"
	@echo "    make publish-prerelease MODE=local TYPE=rc BUMP=preminor       - Publish locally"

.PHONY: help bench build clean test test-core test-otel test-otel-installed test-otel-missing test-openai test-anthropic test-ai-sdk test-latest install-optional-deps publish-beta-local

# -------------------------------------------------------------------------------------------------	#
# AI SDK testing
# -------------------------------------------------------------------------------------------------
.PHONY: test-ai-sdk test-ai-sdk-v1 test-ai-sdk-v2

test-ai-sdk: test-ai-sdk-v1 test-ai-sdk-v2

test-ai-sdk-v1:
	pnpm prune
	$(call pnpm_install_no_save,ai@^3.0.0)
	pnpm test:ai-sdk-v1

test-ai-sdk-v2:
	pnpm prune
	npm_config_save=false npm_config_lockfile=false pnpm add ai@beta @ai-sdk/openai@beta @ai-sdk/anthropic@beta @ai-sdk/provider@beta
	pnpm test:ai-sdk-v2
# this should still work
	pnpm test:ai-sdk-v1

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

# -------------------------------------------------------------------------------------------------
# OpenTelemetry testing
# -------------------------------------------------------------------------------------------------

.PHONY: test-otel test-otel-installed test-otel-missing

test-otel-installed:
	pnpm prune
	npm_config_save=false npm_config_lockfile=false pnpm add "@opentelemetry/api" "@opentelemetry/sdk-trace-base" "@opentelemetry/exporter-trace-otlp-http"
	pnpm test:otel

test-otel-missing:
	pnpm prune
	# Verify OpenTelemetry packages are not installed
	@echo "Verifying OpenTelemetry packages are not installed..."
	@if pnpm list @opentelemetry/api 2>/dev/null | grep -q "@opentelemetry/api"; then \
		echo "ERROR: @opentelemetry/api is installed, but test requires it to be missing"; \
		exit 1; \
	fi
	pnpm test:otel-no-deps

test-otel: test-otel-installed test-otel-missing

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

.PHONY: test-pnpm test test-latest prune installing-optional-deps docs build verify-ci bench

install-optional-deps:
	npm_config_save=false npm_config_lockfile=false pnpm add "openai" "@anthropic-ai/sdk"


# Test everything but the wrappers.
test-core:
	pnpm prune
	pnpm test

# Test everything
test: test-core test-otel test-openai test-anthropic test-ai-sdk

# Test the core and the latest versions of wrappers.
test-latest: test-core test-otel test-anthropic-latest test-openai-latest


prune:
	pnpm prune

docs:
	pnpm run docs

build:
	pnpm run build

publish-beta-local: build
	pnpm publish --tag beta

# -------------------------------------------------------------------------------------------------
# Pre-release publishing
# Can publish locally or trigger GitHub Actions workflow
# Usage: make publish-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>
# -------------------------------------------------------------------------------------------------
.PHONY: publish-prerelease

# Default values
TYPE ?= beta
BUMP ?= prerelease

publish-prerelease:
	@if [ -z "$(MODE)" ] || ! echo "$(MODE)" | grep -qE '^(local|gh)$$'; then \
		echo ""; \
		echo "ERROR: MODE must be either 'local' or 'gh'"; \
		echo ""; \
		echo "Got: MODE=$(MODE)"; \
		echo ""; \
		echo "Usage: make publish-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make publish-prerelease MODE=local TYPE=beta BUMP=prerelease   - Publish locally"; \
		echo "  make publish-prerelease MODE=gh TYPE=alpha BUMP=prepatch       - Trigger GitHub Actions"; \
		echo ""; \
		exit 1; \
	fi
	@if [ -z "$(TYPE)" ]; then \
		echo "ERROR: TYPE parameter is required"; \
		echo "Usage: make publish-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>"; \
		exit 1; \
	fi
	@if ! echo "$(TYPE)" | grep -qE '^(beta|alpha|rc)$$'; then \
		echo "ERROR: TYPE must be one of: beta, alpha, rc"; \
		exit 1; \
	fi
	@if ! echo "$(BUMP)" | grep -qE '^(prerelease|prepatch|preminor|premajor)$$'; then \
		echo "ERROR: BUMP must be one of: prerelease, prepatch, preminor, premajor"; \
		exit 1; \
	fi
	@if [ "$(MODE)" = "local" ]; then \
		echo "Publishing $(TYPE) pre-release locally ($(BUMP))..."; \
		./scripts/publish-prerelease.sh $(TYPE) $(BUMP); \
	else \
		echo "Triggering GitHub Actions workflow to publish $(TYPE) pre-release ($(BUMP))..."; \
		gh workflow run publish-js-sdk-prerelease.yaml \
			-f prerelease_type=$(TYPE) \
			-f version_bump=$(BUMP); \
		echo "Workflow triggered! Check status at:"; \
		echo "https://github.com/braintrustdata/braintrust-sdk/actions/workflows/publish-js-sdk-prerelease.yaml"; \
	fi

bench:
	npx tsx src/queue.bench.ts


# note: we don't use the docs in ci, but this makes sure they keep building

verify-ci: build docs test

build-sdk-js:
	npm run build

publish-sdk-js: build-sdk-js
	./scripts/validate-release.sh
	npm publish


# This is the only method I could find to install a package without explicitly
# adding a dependency or modifying lock files.
define pnpm_install_no_save
	@echo "No save installing "$(1)""
	npm_config_save=false npm_config_lockfile=false pnpm add "$(1)"
endef

clean:
	npm run clean
