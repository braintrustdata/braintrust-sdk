include ../../common.mk

.PHONY: setup test clean list install-deps

.PHONY: setup test


BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up deno-node scenario"
	mise install
	@# Deno uses workspace links - need SDK dist/ folder to exist
	echo "==> Extracting SDK tarball for workspace link"; \
	echo "==> Resolved tarball path: $(BRAINTRUST_TAR)"; \
	cd ../../..; tar -xzf $(BRAINTRUST_TAR) package/dist

list:
	@echo "Available tests:"
	@find tests -name '*.eval.ts' | sort

ifdef _NEED_SERVER
test: _start-server
	@$(_SERVER_TRAP) \
	$(_MOCK_ENV) $(MAKE) _run-test
else
test: _run-test
endif

_run-test: setup
	@echo "==> Running eval-deno tests (Deno runtime with npm: imports)"
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.ts' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.ts); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		OUTPUT=$$(BRAINTRUST_API_KEY=$${BRAINTRUST_API_KEY} BRAINTRUST_API_URL=$${BRAINTRUST_API_URL} BRAINTRUST_APP_URL=$${BRAINTRUST_APP_URL} mise exec -- deno run --allow-all npm:braintrust eval "$$test" 2>&1); \
		EXIT_CODE=$$?; \
		echo "$$OUTPUT" | head -5 | sed 's/^/      /'; \
		if [ $$EXIT_CODE -eq 0 ] && echo "$$OUTPUT" | grep -qE "(Experiment summary|View results)"; then \
			echo "    ✓ Passed"; \
		else \
			echo "    ✗ Failed (exit code: $$EXIT_CODE)"; \
			echo "    Full output:"; \
			echo "$$OUTPUT" | sed 's/^/      /'; \
			FAILED=1; \
		fi; \
		echo ""; \
	done; \
	if [ $$FAILED -eq 0 ]; then \
		echo "✓ All eval-deno tests passed"; \
	else \
		echo "✗ Some eval-deno tests failed"; \
	fi; \
	exit $$FAILED

clean:
	@echo "==> Cleaning eval-deno scenario"
	@rm -rf node_modules deno.lock
