.PHONY: setup test

setup:
	@echo "==> Setting up deno-browser scenario"
	mise install
	@# Deno uses workspace links - need SDK dist/ folder to exist
	@if [ ! -d ../../../dist ]; then \
		if [ -n "$(BRAINTRUST_TAR)" ]; then \
			echo "==> Extracting SDK tarball for workspace link"; \
			cd ../../.. && tar -xzf ../../../$(BRAINTRUST_TAR) --strip-components=1 package/dist; \
		else \
			echo "==> Building SDK for workspace link"; \
			cd ../../.. && pnpm exec turbo build --filter=braintrust; \
		fi; \
	fi
	deno install

test: setup
	deno test --sloppy-imports --allow-all tests/*.test.ts
