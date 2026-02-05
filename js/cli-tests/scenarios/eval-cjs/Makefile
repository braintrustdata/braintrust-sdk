.PHONY: setup test clean

BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up eval-cjs scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		exit 1; \
	fi
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	@echo "==> Installing dependencies"
	@npm install

test: setup
	@echo "==> Running eval-cjs CLI tests"
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.js' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.js); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		if npm run braintrust -- eval "$$test" --jsonl 2>&1 | ../../validate-jsonl.sh; then \
			echo "    ✓ Passed"; \
		else \
			echo "    ✗ Failed"; \
			FAILED=1; \
		fi; \
		echo ""; \
	done; \
	if [ $$FAILED -eq 0 ]; then \
		echo "✓ All eval-cjs tests passed"; \
	else \
		echo "✗ Some eval-cjs tests failed"; \
	fi; \
	exit $$FAILED

clean:
	@echo "==> Cleaning eval-cjs scenario"
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
