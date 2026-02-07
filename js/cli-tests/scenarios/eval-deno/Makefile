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
	@echo "DEBUG: mise exec path: $$(which mise || echo 'mise not found')"
	@echo "DEBUG: deno version: $$(mise exec -- deno --version 2>&1 | head -1 || echo 'deno failed')"
	@echo "DEBUG: node_modules/braintrust exists: $$([ -d node_modules/braintrust ] && echo 'yes' || echo 'no')"
	@echo "DEBUG: BRAINTRUST_API_KEY=$$([ -n "$${BRAINTRUST_API_KEY}" ] && echo '<redacted>' || echo '<not set>')"
	@echo "DEBUG: BRAINTRUST_API_URL=$${BRAINTRUST_API_URL:-<not set>}"
	@echo "DEBUG: BRAINTRUST_APP_URL=$${BRAINTRUST_APP_URL:-<not set>}"
	@echo "DEBUG: Testing mock server connection: $$(curl -s $${BRAINTRUST_API_URL:-http://localhost:19891}/version 2>&1 | head -1 || echo 'server not reachable')"
	@echo ""
	@FAILED=0; \
	TESTS=$$(find tests -name '*.eval.ts' | sort); \
	TOTAL=$$(echo "$$TESTS" | wc -l | tr -d ' '); \
	COUNT=0; \
	for test in $$TESTS; do \
		COUNT=$$((COUNT + 1)); \
		TEST_NAME=$$(basename "$$test" .eval.ts); \
		echo "  [$$COUNT/$$TOTAL] Testing $$TEST_NAME..."; \
		echo "    DEBUG: Running: mise exec -- deno run --allow-all $$test"; \
		echo "    DEBUG: Test env - API_KEY=$$([ -n "$${BRAINTRUST_API_KEY}" ] && echo '<redacted>' || echo '<unset>') API_URL=$${BRAINTRUST_API_URL:-<unset>}"; \
		OUTPUT=$$(BRAINTRUST_API_KEY=$${BRAINTRUST_API_KEY} BRAINTRUST_API_URL=$${BRAINTRUST_API_URL} BRAINTRUST_APP_URL=$${BRAINTRUST_APP_URL} mise exec -- deno run --allow-all "$$test" 2>&1); \
		EXIT_CODE=$$?; \
		echo "    DEBUG: Exit code: $$EXIT_CODE"; \
		echo "    DEBUG: Output length: $$(echo "$$OUTPUT" | wc -l) lines"; \
		echo "    DEBUG: First 5 lines of output:"; \
		echo "$$OUTPUT" | head -5 | sed 's/^/      /'; \
		echo "    DEBUG: Grep check: $$(echo "$$OUTPUT" | grep -E "(Experiment summary|View results)" | head -1 || echo 'no match')"; \
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
