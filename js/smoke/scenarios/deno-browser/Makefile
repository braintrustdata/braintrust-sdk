.PHONY: setup test

setup:
	@echo "==> Setting up deno-browser scenario"
	mise install
	@# Deno uses workspace links - need SDK dist/ folder to exist
	if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Extracting SDK tarball for workspace link"; \
		TARBALL_PATH="$$(cd ../.. && pwd)/$(BRAINTRUST_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../../.. && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building SDK for workspace link"; \
		cd ../../.. && pnpm exec turbo build --filter=braintrust; \
	fi; \

test: setup
	@# Run only tests under the local tests/ directory
	deno test --sloppy-imports --allow-all tests/*.test.ts
