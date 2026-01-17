# Auto-discover scenarios (any folder in scenarios/ with a Makefile)
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print | sed 's|scenarios/||' | sort)

.PHONY: help setup test list

help:
	@echo "Smoke-v2 Test Infrastructure"
	@echo ""
	@echo "Available targets:"
	@echo "  make test            - Run all scenarios (builds SDK once)"
	@echo "  make test <scenario> - Run specific scenario (e.g., make test otel-v1)"
	@echo "  make setup           - Build SDK + shared package"
	@echo "  make list            - List discovered scenarios"
	@echo ""
	@echo "Discovered scenarios:"
	@for scenario in $(SCENARIOS); do echo "  - $$scenario"; done

# Build SDK + shared package (pnpm/tsup caching makes rebuilds fast)
setup:
	@echo "==> Building SDK + shared package"
	cd ../.. && pnpm build && mkdir -p artifacts && npm pack --pack-destination artifacts
	@# Copy to well-known names
	@for f in ../artifacts/braintrust-*.tgz; do \
		if [ "$$(basename $$f)" != "braintrust-latest.tgz" ] && [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
			cp "$$f" ../artifacts/braintrust-latest.tgz; \
			break; \
		fi; \
	done
	cd shared && npm ci && npm run build

# Run all scenarios or a specific scenario
test:
	@if [ -z "$(filter-out test,$(MAKECMDGOALS))" ]; then \
		echo "==> Running all scenarios"; \
		$(MAKE) setup; \
		for scenario in $(SCENARIOS); do \
			echo ""; \
			echo "=== Testing $$scenario ==="; \
			$(MAKE) -C scenarios/$$scenario test || exit 1; \
		done; \
		echo ""; \
		echo "✓ All scenarios passed"; \
	else \
		SCENARIO="$(filter-out test,$(MAKECMDGOALS))"; \
		if [ -d "scenarios/$$SCENARIO" ]; then \
			echo "==> Running scenario: $$SCENARIO"; \
			$(MAKE) -C scenarios/$$SCENARIO test; \
		else \
			echo "Error: Scenario '$$SCENARIO' not found"; \
			echo "Available scenarios:"; \
			for s in $(SCENARIOS); do echo "  - $$s"; done; \
			exit 1; \
		fi; \
	fi

# List discovered scenarios
list:
	@echo "Discovered scenarios:"
	@for scenario in $(SCENARIOS); do echo "  - $$scenario"; done

# Make scenario names valid targets (no-ops to support "make test otel-v1")
$(SCENARIOS):
	@:
