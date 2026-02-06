# Auto-discover scenarios with Makefiles
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print 2>/dev/null | sed 's|scenarios/||')

include common.mk

.PHONY: test list clean $(SCENARIOS)

ifdef _NEED_SERVER
test: _start-server
	@$(_SERVER_TRAP) \
	$(_MOCK_ENV) _BT_SERVER_RUNNING=1 \
	$(MAKE) _run-scenarios
else
test: _run-scenarios
endif

_run-scenarios:
	@FAILED=""; \
	for scenario in $(SCENARIOS); do \
		echo ""; \
		echo "==> Running CLI test scenario: $$scenario"; \
		echo ""; \
		if ! $(MAKE) -C scenarios/$$scenario test; then \
			FAILED="$$FAILED $$scenario"; \
		fi; \
	done; \
	echo ""; \
	if [ -n "$$FAILED" ]; then \
		echo "✗ Failed scenarios:$$FAILED"; \
		exit 1; \
	fi; \
	echo "✓ All scenarios passed"

$(SCENARIOS):
	@echo ""
	@echo "==> Running CLI test scenario: $@"
	@echo ""
	@$(MAKE) -C scenarios/$@ test

list:
	@echo "Available CLI test scenarios:"
	@if [ -z "$(SCENARIOS)" ]; then \
		echo "  (none)"; \
	else \
		echo "$(SCENARIOS)" | tr ' ' '\n' | sed 's/^/  - /'; \
	fi

clean: _stop-server
	@for scenario in $(SCENARIOS); do \
		echo "Cleaning $$scenario..."; \
		$(MAKE) -C scenarios/$$scenario clean 2>/dev/null || true; \
	done
