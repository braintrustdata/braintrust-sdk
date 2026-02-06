.PHONY: setup test clean

BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up vite-node scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		exit 1; \
	fi
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	@echo "==> Installing dependencies"
	@npm install

test: setup
	@echo "==> Running vite-node tests"
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.ts' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.ts); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		if npm run vite-node "$$test"; then \
			echo "    ✓ Passed"; \
		else \
			echo "    ✗ Failed"; \
			FAILED=1; \
		fi; \
		echo ""; \
	done; \
	if [ $$FAILED -eq 0 ]; then \
		echo "✓ All vite-node tests passed"; \
	else \
		echo "✗ Some vite-node tests failed"; \
	fi; \
	exit $$FAILED

clean:
	@echo "==> Cleaning vite-node scenario"
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
