# Default target
help:
	@echo "Braintrust JS SDK Makefile"
	@echo ""
	@echo "Available commands:"
	@echo "  make help                - Show this help message"
	@echo "  make build              - Build the SDK"
	@echo "  make clean              - Clean build artifacts"
	@echo "  make install-optional-deps - Install optional dependencies"
	@echo "  make test               - Run all tests (core + wrappers)"
	@echo "  make test-core          - Run core tests only"
	@echo "  make test-openai        - Run OpenAI wrapper tests"
	@echo "  make test-anthropic     - Run Anthropic wrapper tests"
	@echo "  make bench              - Run queue performance benchmarks"
	@echo "  make test-latest        - Run core + latest versions of wrappers"

.PHONY: help bench build clean test test-core test-openai test-anthropic test-latest install-optional-deps

# -------------------------------------------------------------------------------------------------	#
# ai.sdk testing
# -------------------------------------------------------------------------------------------------
.PHONY: test-ai-sdk test-ai-sdk-latest test-ai-sdk-%

test-ai-sdk: test-ai-sdk-latest test-ai-sdk-5.0.0-beta

test-ai-sdk-latest:
	pnpm prune
	$(call pnpm_install_no_save,ai@beta)
	pnpm test:ai-sdk

test-ai-sdk-%:
	pnpm prune
	$(call pnpm_install_no_save,ai@$*)
	pnpm test:ai-sdk

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
test: test-core test-openai test-anthropic

# Test the core and the latest versions of wrappers.
test-latest: test-core test-anthropic-latest test-openai-latest

prune:
	pnpm prune

docs:
	pnpm run docs

build:
	pnpm run build

bench:
	npx tsx src/queue.bench.ts


# note: we don't use the docs in ci, but this makes sure they keep building

verify-ci: build docs test




# This is the only method I could find to install a package without explicitly
# adding a dependency or modifying lock files.
define pnpm_install_no_save
	@echo "No save installing "$(1)""
	npm_config_save=false npm_config_lockfile=false pnpm add "$(1)"
endef

clean:
	npm run clean
