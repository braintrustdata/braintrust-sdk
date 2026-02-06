.PHONY: test list clean

# Auto-discover all scenarios with Makefiles
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d \
	-exec test -f {}/Makefile \; -print | sed 's|scenarios/||' | sort)

test:
	@echo "==> Running all framework test scenarios"
	@FAILED=0; \
	for scenario in $(SCENARIOS); do \
		echo ""; \
		echo "==> Running framework test scenario: $$scenario"; \
		echo ""; \
		$(MAKE) -C scenarios/$$scenario test || FAILED=1; \
	done; \
	if [ $$FAILED -eq 0 ]; then \
		echo ""; \
		echo "✓ All framework test scenarios passed"; \
	else \
		echo ""; \
		echo "✗ Some framework test scenarios failed"; \
		exit 1; \
	fi

list:
	@echo "Available framework test scenarios:"
	@for scenario in $(SCENARIOS); do \
		echo "  - $$scenario"; \
	done

clean:
	@echo "==> Cleaning all framework test scenarios"
	@for scenario in $(SCENARIOS); do \
		$(MAKE) -C scenarios/$$scenario clean; \
	done
