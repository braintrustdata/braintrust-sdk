# Auto-discover scenarios with Makefiles
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print 2>/dev/null | sed 's|scenarios/||')

.PHONY: test list clean $(SCENARIOS)

test: $(SCENARIOS)

list:
	@echo "Available CLI test scenarios:"
	@if [ -z "$(SCENARIOS)" ]; then \
		echo "  (none)"; \
	else \
		echo "$(SCENARIOS)" | tr ' ' '\n' | sed 's/^/  - /'; \
	fi

clean:
	@for scenario in $(SCENARIOS); do \
		echo "Cleaning $$scenario..."; \
		$(MAKE) -C scenarios/$$scenario clean 2>/dev/null || true; \
	done

$(SCENARIOS):
	@echo ""
	@echo "==> Running CLI test scenario: $@"
	@echo ""
	@$(MAKE) -C scenarios/$@ test
