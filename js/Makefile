.PHONY: prune test-anthropic test-anthropic-@0.39.0 test-anthropic-@0.38.0 test-anthropic-latest test

prune:
	pnpm prune

# A workaround to test with an without optional dependencies. There may be snazzier ways to do this.
test-anthropic: test-anthropic-latest test-anthropic-0.39.0 test-anthropic-0.38.0

test-anthropic-latest:
	pnpm prune
	$(call pnpm_install_no_save,@anthropic-ai/sdk)
	pnpm test:anthropic

test-anthropic-%:
	pnpm prune
	$(call pnpm_install_no_save,@anthropic-ai/sdk@$*)
	pnpm test:anthropic

# Test everything but the wrappers.
test-pnpm:
	pnpm prune
	pnpm test

# Test everything
test: test-anthropic test-pnpm

# Test the core and the latest versions of wrappers.
test-latest: test-pnpm test-anthropic-latest




# This is the only method I could find to install a package without explicitly
# adding a dependency or modifying lock files.
define pnpm_install_no_save
	@echo "No save installing "$(1)""
	npm_config_save=false npm_config_lockfile=false pnpm add "$(1)"
endef
