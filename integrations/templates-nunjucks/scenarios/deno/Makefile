.PHONY: setup test

setup:
	@echo "==> Setting up templates-nunjucks deno scenario"
	mise install

	@# Deno uses workspace links - need SDK dist/ folder to exist
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Extracting SDK tarball for workspace link"; \
		TARBALL_PATH="$$(cd ../../../.. && pwd)/$(BRAINTRUST_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../../../../js && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building SDK for workspace link"; \
		cd ../../../../js && pnpm exec turbo build --filter=braintrust; \
	fi

	@# Deno uses workspace links - need templates-nunjucks dist/ folder to exist
	@if [ -n "$(BRAINTRUST_TEMPLATES_NUNJUCKS_TAR)" ]; then \
		echo "==> Extracting templates-nunjucks tarball for workspace link"; \
		TARBALL_PATH="$$(cd ../../../.. && pwd)/$(BRAINTRUST_TEMPLATES_NUNJUCKS_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../.. && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building templates-nunjucks for workspace link"; \
		cd ../.. && pnpm exec turbo build --filter=@braintrust/templates-nunjucks-js; \
	fi

test: setup
	@echo "==> Running deno tests"
	deno test --sloppy-imports --allow-all tests/*.test.ts
