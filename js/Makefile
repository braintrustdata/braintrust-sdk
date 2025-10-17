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
	@echo "  make test-google-genai  - Run Google GenAI wrapper tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"

.PHONY: help bench build clean test test-core test-otel test-otel-installed test-otel-missing test-openai test-anthropic test-google-genai test-ai-sdk test-latest install-optional-deps publish-beta-local

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

# ----
# Google GenAI
# ----
test-google-genai: test-google-genai-latest

test-google-genai-latest:
	pnpm prune
	$(call pnpm_install_no_save,@google/genai)
	pnpm test:google-genai


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
test: test-core test-otel test-openai test-anthropic test-ai-sdk test-google-genai

# Test the core and the latest versions of wrappers.
test-latest: test-core test-otel test-anthropic-latest test-openai-latest test-google-genai


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
