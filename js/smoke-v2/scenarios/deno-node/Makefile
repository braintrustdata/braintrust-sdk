.PHONY: setup test

setup:
	@echo "==> Setting up deno-node scenario"
	mise install

	# Build SDK (Deno will use dist/ directly)
	@if [ ! -d ../../../dist ]; then \
		cd ../../.. && pnpm build; \
	fi

	deno add ../../../

test: setup
	deno test --allow-all tests/*.test.ts
