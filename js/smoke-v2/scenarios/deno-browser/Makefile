.PHONY: setup test

setup:
	@echo "==> Setting up deno-browser scenario"
	mise install
	@# Deno uses workspace links - always needs SDK built (doesn't use tarballs)
	@if [ ! -d ../../../dist ]; then \
		echo "==> Building SDK for Deno workspace link"; \
		cd ../../.. && pnpm turbo build --filter=braintrust; \
	fi
	deno install

test: setup
	deno test --sloppy-imports --allow-all tests/*.test.ts
