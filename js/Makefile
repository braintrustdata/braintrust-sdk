.PHONY: examples prune test-anthropic test-anthropic-@0.39.0 test-anthropic-@0.38.0 test-anthropic-latest test

examples:
	./pnpm_no_save install @anthropic-ai/sdk
	pnpm examples

prune:
	pnpm prune

# A workaround to test with an without optional dependencies. There may be snazzier ways to do this.
test-anthropic: test-anthropic-latest test-anthropic-0.39.0 test-anthropic-0.38.0

test-anthropic-latest:
	pnpm prune
	./pnpm_no_save install @anthropic-ai/sdk
	pnpm test:anthropic

test-anthropic-%:
	pnpm prune
	./pnpm_no_save install @anthropic-ai/sdk@$*
	pnpm test:anthropic

# Test everything but the wrappers.
test-pnpm:
	pnpm prune
	pnpm test

# Test everything
test: test-anthropic test-pnpm

# Test the core and the latest versions of wrappers.
test-latest: test-anthropic-latest test-pnpm
