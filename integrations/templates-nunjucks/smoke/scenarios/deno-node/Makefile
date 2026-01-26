.PHONY: setup test

setup:
	@echo "==> Setting up templates-nunjucks deno scenario"
	mise install

	@# Build or extract braintrust SDK (workspace link will use dist/)
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Extracting SDK tarball for workspace link"; \
		TARBALL_PATH="$$(cd ../../../../../js/smoke && pwd)/$(BRAINTRUST_TAR)"; \
		echo "==> Resolved tarball path: $$TARBALL_PATH"; \
		cd ../../../../../js && tar -xzf "$$TARBALL_PATH" --strip-components=1 package/dist; \
	else \
		echo "==> Building SDK"; \
		cd ../../../../../js && mise exec -- pnpm exec turbo build --filter=braintrust; \
	fi

	@# Build @braintrust/templates-nunjucks-js (direct import will use dist/)
	@echo "==> Building @braintrust/templates-nunjucks-js package"; \
	cd ../../.. && mise exec -- pnpm exec turbo build --filter=@braintrust/templates-nunjucks-js

	@# Build shared package (if not running from parent)
	@if [ -z "$(SMOKE_V2_SHARED_DIST)" ]; then \
		echo "==> Building shared package"; \
		cd ../../../../../js/smoke/shared && npm install && npm run build; \
	fi

test: setup
	@echo "==> Running deno tests"
	mise exec -- deno test --no-check --sloppy-imports --allow-all tests/*.test.ts
