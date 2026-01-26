.PHONY: setup test

setup:
	@echo "==> Setting up templates-nunjucks deno scenario"
	mise install

	@# Deno uses workspace links - need SDK dist/ folder to exist
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Extracting SDK tarball for workspace link"; \
		SMOKE_DIR="$$(cd ../../../../../js/smoke && pwd)"; \
		TARBALL_PATH="$$SMOKE_DIR/$(BRAINTRUST_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../../../../../js && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building SDK for workspace link"; \
		cd ../../../../../js && mise exec -- pnpm exec turbo build --filter=braintrust; \
	fi

	@# Deno uses workspace links - need templates-nunjucks dist/ folder to exist
	@if [ -n "$(BRAINTRUST_TEMPLATES_NUNJUCKS_JS_TAR)" ]; then \
		echo "==> Extracting templates-nunjucks tarball for workspace link"; \
		SMOKE_DIR="$$(cd ../../../../../js/smoke && pwd)"; \
		TARBALL_PATH="$$SMOKE_DIR/$(BRAINTRUST_TEMPLATES_NUNJUCKS_JS_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../../.. && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building templates-nunjucks for workspace link"; \
		cd ../../.. && mise exec -- pnpm exec turbo build --filter=@braintrust/templates-nunjucks-js; \
	fi

test: setup
	@echo "==> Running deno tests"
	mise exec -- deno test --no-check --sloppy-imports --allow-all tests/*.test.ts
