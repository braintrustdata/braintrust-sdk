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
	@echo "  make test-otel          - Run OpenTelemetry tests (both installed and missing)"
	@echo "  make test-otel-installed - Run OpenTelemetry tests with library installed"
	@echo "  make test-otel-no-deps  - Run OpenTelemetry tests without library"
	@echo "  make test-openai        - Run OpenAI wrapper tests"
	@echo "  make test-anthropic     - Run Anthropic wrapper tests"
	@echo "  make test-google-genai  - Run Google GenAI wrapper tests"
	@echo "  make test-ai-sdk-4      - Run AI SDK v4 wrapper tests"
	@echo "  make test-ai-sdk-5      - Run AI SDK v5 wrapper tests"
	@echo "  make test-mastra        - Run Mastra wrapper tests"
	@echo "  make test-claude-agent-sdk - Run Claude Agent SDK wrapper tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"

.PHONY: help bench build clean test test-core test-otel test-otel-installed test-otel-no-deps test-openai test-anthropic test-google-genai test-ai-sdk-4 test-ai-sdk-5 test-mastra test-claude-agent-sdk test-latest install-optional-deps publish-beta-local

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
# AI SDK v4 testing
# -------------------------------------------------------------------------------------------------

test-ai-sdk-4:
	cd src/wrappers/ai-sdk-4 && pnpm install && pnpm test

# -------------------------------------------------------------------------------------------------
# AI SDK v5 testing
# -------------------------------------------------------------------------------------------------

test-ai-sdk-5:
	cd src/wrappers/ai-sdk-5 && pnpm install && pnpm test

# -------------------------------------------------------------------------------------------------
# Mastra testing
# -------------------------------------------------------------------------------------------------

test-mastra:
	cd src/wrappers/mastra && pnpm install && pnpm test

# -------------------------------------------------------------------------------------------------
# Claude Agent SDK testing
# -------------------------------------------------------------------------------------------------

test-claude-agent-sdk:
	cd src/wrappers/claude-agent-sdk && pnpm install && pnpm test


# -------------------------------------------------------------------------------------------------
# OpenTelemetry testing
# -------------------------------------------------------------------------------------------------

.PHONY: test-otel test-otel-installed test-otel-no-deps

test-otel-installed:
	pnpm prune
	npm_config_save=false npm_config_lockfile=false pnpm add "@opentelemetry/api" "@opentelemetry/sdk-trace-base" "@opentelemetry/exporter-trace-otlp-http" "@opentelemetry/core"
	vitest run --dir src/otel

# test-otel only runs with dependencies installed
test-otel: test-otel-installed

# test-otel-no-deps runs in isolated workspace without OpenTelemetry packages
test-otel-no-deps:
	cd src/otel-no-deps-tests && pnpm install && pnpm test

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
	npm_config_save=false npm_config_lockfile=false pnpm add \
		"openai" \
		"@anthropic-ai/sdk" \
		"@opentelemetry/api" \
		"@opentelemetry/sdk-trace-base" \
		"@opentelemetry/exporter-trace-otlp-http" \
		"@opentelemetry/core" \
		"@opentelemetry/context-async-hooks"


# Test everything but the wrappers.
test-core:
	pnpm prune
	pnpm test

# Test everything
test: test-core test-otel test-openai test-anthropic test-google-genai

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
