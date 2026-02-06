include ../../common.mk

.PHONY: setup test clean list install-deps

BRAINTRUST_TAR ?= ../../braintrust-latest.tgz

setup: install-deps
	@echo "==> Setting up eval-deno scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		echo "Run 'make build-tarball' from sdk/js/ first"; \
		exit 1; \
	fi
	@echo "==> Installing Deno via mise"
	@mise install
	@echo "==> Extracting SDK tarball for npm: imports"
	@mkdir -p node_modules
	@tar -xzf "$(BRAINTRUST_TAR)" -C node_modules
	@mv node_modules/package node_modules/braintrust

install-deps:

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
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.ts' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.ts); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		if mise exec -- deno run --allow-all "$$test" 2>&1 | grep -qE "(Experiment summary|View results)"; then \
			echo "    ✓ Passed"; \
		else \
			echo "    ✗ Failed"; \
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
