include ../../common.mk

.PHONY: setup test clean

BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up eval-esm scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		exit 1; \
	fi
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	@echo "==> Installing dependencies"
	@npm install

ifdef _NEED_SERVER
test: _start-server
	@$(_SERVER_TRAP) \
	$(_MOCK_ENV) $(MAKE) _run-test
else
test: _run-test
endif

_run-test: setup
	@echo "==> Running eval-esm CLI tests"
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.mjs' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.mjs); \
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
		echo "✓ All eval-esm tests passed"; \
	else \
		echo "✗ Some eval-esm tests failed"; \
	fi; \
	exit $$FAILED

clean:
	@echo "==> Cleaning eval-esm scenario"
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
