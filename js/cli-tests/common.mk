# Shared mock server management for CLI tests.
# Include from cli-tests/Makefile or cli-tests/scenarios/*/Makefile.
#
# CI=1 means "use the mock server". The server is started automatically and
# the SDK env vars are overridden to point at it. When a parent Makefile has
# already started the server it sets _BT_SERVER_RUNNING=1 so children skip
# starting a second one.

_COMMON_DIR := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
_TEST_SERVER_DIR := $(_COMMON_DIR)/../test-server
_TEST_SERVER_PORT ?= 19891
_TEST_SERVER_URL := http://localhost:$(_TEST_SERVER_PORT)
_TEST_SERVER_PID_FILE := .mock-server.pid

_NEED_SERVER := $(if $(CI),$(if $(_BT_SERVER_RUNNING),,yes),)

_SERVER_TRAP = trap '$(MAKE) _stop-server 2>/dev/null' EXIT;

_MOCK_ENV = env -u BRAINTRUST_ORG_NAME \
	BRAINTRUST_API_KEY=fake-test-key-cli-tests \
	BRAINTRUST_API_URL=$(_TEST_SERVER_URL) \
	BRAINTRUST_APP_URL=$(_TEST_SERVER_URL)

.PHONY: _start-server _stop-server

_start-server:
	@$(MAKE) _stop-server 2>/dev/null; \
		lsof -ti :$(_TEST_SERVER_PORT) | xargs kill 2>/dev/null || true
	@echo "==> Starting mock API server on port $(_TEST_SERVER_PORT)"
	@cd $(_TEST_SERVER_DIR) && PORT=$(_TEST_SERVER_PORT) node mock-braintrust-api.js & \
		echo $$! > $(_TEST_SERVER_PID_FILE)
	@for i in $$(seq 1 30); do \
		if curl -s $(_TEST_SERVER_URL)/version > /dev/null 2>&1; then \
			echo "Mock server is ready (pid $$(cat $(_TEST_SERVER_PID_FILE)))"; \
			break; \
		fi; \
		if [ $$i -eq 30 ]; then \
			echo "Error: Mock server failed to start"; \
			$(MAKE) _stop-server; \
			exit 1; \
		fi; \
		sleep 1; \
	done

_stop-server:
	@if [ -f $(_TEST_SERVER_PID_FILE) ]; then \
		kill $$(cat $(_TEST_SERVER_PID_FILE)) 2>/dev/null || true; \
		rm -f $(_TEST_SERVER_PID_FILE); \
		echo "Mock server stopped"; \
	fi
