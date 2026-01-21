.PHONY: setup test

setup:
	@echo "==> Setting up cloudflare-vite-hono"
	mise install
	@# Check if BRAINTRUST_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Using BRAINTRUST_TAR: $(BRAINTRUST_TAR)"; \
	else \
		echo "==> Building SDK"; \
		cd ../../.. && pnpm exec turbo build --filter=braintrust && mkdir -p artifacts && pnpm pack --pack-destination artifacts; \
		\
		for f in artifacts/braintrust-*.tgz; do \
			[ "$$(basename $$f)" = "braintrust-latest.tgz" ] && continue; \
			cp "$$f" artifacts/braintrust-latest.tgz; \
			break; \
		done; \
	fi
	@# Build shared package if needed
	@# Build shared package (if not running from parent)
	@if [ -z "$(SMOKE_V2_SHARED_DIST)" ]; then \
		echo "==> Building shared package"; \
		cd ../../shared && npm ci && npm run build; \
	fi
	npm install --no-package-lock

test: setup
	@echo "==> Running cloudflare-vite-hono tests"
	@echo ""
	@npx tsx tests/worker.test.mjs || WORKER_FAILED=1; \
	echo ""; \
	npx tsx tests/node-esm-import.test.mjs || NODE_ESM_IMPORT_FAILED=1; \
	echo ""; \
	npx tsx tests/vite-dev.test.mjs || true; \
	if [ "$$WORKER_FAILED" = "1" ] || [ "$$NODE_ESM_IMPORT_FAILED" = "1" ]; then exit 1; fi
