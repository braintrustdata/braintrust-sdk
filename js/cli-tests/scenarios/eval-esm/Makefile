.PHONY: setup test clean

# Auto-create tarball if not provided
# Use version from package.json for tarball name
BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up eval-esm scenario"
	@# Ensure tarball exists
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		exit 1; \
	fi
	@# Copy to well-known path
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	@echo "==> Installing dependencies"
	@npm install

test: setup
	@echo "==> Running eval-esm CLI tests"
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.ts' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.ts); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		if npm run braintrust -- eval "$$test" --no-send-logs > /dev/null 2>&1; then \
			echo "    ✓ Passed"; \
		else \
			echo "    ✗ Failed"; \
			FAILED=1; \
		fi; \
		echo ""; \
	done; \
	if [ $$FAILED -eq 0 ]; then \
		echo "✓ All eval-esm tests passed"; \
	else \
		echo "✗ Some eval-esm tests failed"; \
	fi; \
	exit $$FAILED

clean:
	@echo "==> Cleaning eval-esm scenario"
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
