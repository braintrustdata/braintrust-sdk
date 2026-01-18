.PHONY: setup test

setup:
	@echo "==> Setting up nextjs-instrumentation scenario"
	mise install
	@# Check if BRAINTRUST_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Using BRAINTRUST_TAR: $(BRAINTRUST_TAR)"; \
	else \
		echo "==> Building SDK"; \
		cd ../../.. && pnpm turbo build --filter=braintrust && mkdir -p artifacts && pnpm pack --pack-destination artifacts; \
		\
		for f in artifacts/braintrust-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-latest.tgz" ] && \
			   [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
				cp "$$f" artifacts/braintrust-latest.tgz; \
				break; \
			fi; \
		done; \
	fi

	@# Build shared package (if not running from parent)
	@if [ -z "$(SMOKE_V2_SHARED_DIST)" ]; then \
		echo "==> Building shared package"; \
		cd ../../shared && npm ci && npm run build; \
	fi

	@# Check if BRAINTRUST_OTEL_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_OTEL_TAR)" ]; then \
		echo "==> Using BRAINTRUST_OTEL_TAR: $(BRAINTRUST_OTEL_TAR)"; \
	else \
		echo "==> Building @braintrust/otel package"; \
		cd ../../../../integrations/otel-js && pnpm turbo build --filter=@braintrust/otel && pnpm pack --pack-destination ../../js/artifacts; \
		\
		for f in ../../js/artifacts/braintrust-otel-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
				cp "$$f" ../../js/artifacts/braintrust-otel-latest.tgz; \
				break; \
			fi; \
		done; \
	fi
	npm install

test: setup
	@echo "==> Running Next.js build test (webpack bundling)"
	npx next build
	@echo "==> Running Next.js runtime tests (Edge + Node.js)"
	node tests/api-routes.test.mjs
