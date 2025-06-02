.PHONY: prune test-anthropic test-anthropic-@0.39.0 test-anthropic-@0.38.0 test-anthropic-latest test

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

.PHONY: test-pnpm test test-latest prune installing-optional-deps docs build verify-ci

install-optional-deps:
	npm_config_save=false npm_config_lockfile=false pnpm add "openai" "@anthropic-ai/sdk"


# Test everything but the wrappers.
test-pnpm:
	pnpm prune
	pnpm test

# Test everything
test: test-pnpm test-openai test-anthropic

# Test the core and the latest versions of wrappers.
test-latest: test-pnpm test-anthropic-latest test-openai-latest

prune:
	pnpm prune

docs:
	pnpm run docs

build:
	pnpm run build


# note: we don't use the docs in ci, but this makes sure they keep building

verify-ci: build docs test




# This is the only method I could find to install a package without explicitly
# adding a dependency or modifying lock files.
define pnpm_install_no_save
	@echo "No save installing "$(1)""
	npm_config_save=false npm_config_lockfile=false pnpm add "$(1)"
endef
