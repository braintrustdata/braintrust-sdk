.PHONY: setup test

setup:
	@echo "==> Setting up cloudflare-vite-hono"
	mise install
	@# Check if BRAINTRUST_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Using BRAINTRUST_TAR: $(BRAINTRUST_TAR)"; \
	else \
		echo "==> Building SDK"; \
		cd ../../.. && pnpm turbo build --filter=braintrust && mkdir -p artifacts && pnpm pack --pack-destination artifacts; \
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
	@# Run both tests and capture exit codes
	@EXIT_CODE=0; \
	echo "\n==> Test 1: Wrangler (production mode)"; \
	npx tsx tests/worker.test.mjs || EXIT_CODE=$$?; \
	WORKER_EXIT=$$EXIT_CODE; \
	echo "\n==> Test 2: Vite dev server (compatibility check)"; \
	npx tsx tests/vite-dev.test.mjs || EXIT_CODE=$$?; \
	VITE_EXIT=$$EXIT_CODE; \
	echo "\n==> Test Summary"; \
	echo "  Wrangler test: $$([[ $$WORKER_EXIT -eq 0 ]] && echo 'PASS' || echo 'FAIL')"; \
	echo "  Vite dev test: $$([[ $$VITE_EXIT -eq 0 ]] && echo 'PASS' || echo 'FAIL (expected)')"; \
	if [[ $$WORKER_EXIT -ne 0 ]]; then \
		echo "\n❌ Wrangler test failed (exit code $$WORKER_EXIT)"; \
		exit $$WORKER_EXIT; \
	fi; \
	echo "\n✅ Wrangler test passed"; \
	if [[ $$VITE_EXIT -ne 0 ]]; then \
		echo "⚠️  Vite dev test failed (exit code $$VITE_EXIT) - this is expected, see README"; \
	fi
