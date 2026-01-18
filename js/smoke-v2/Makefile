# Auto-discover scenarios (any folder in scenarios/ with a Makefile)
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print | sed 's|scenarios/||' | sort)

.PHONY: help setup test list clean

# =============================================================================
# Help
# =============================================================================

help:
	@echo "Smoke-v2 Test Infrastructure"
	@echo ""
	@echo "Available targets:"
	@echo "  make test            - Run all scenarios (builds SDK once if needed)"
	@echo "  make test <scenario> - Run specific scenario (e.g., make test otel-v1)"
	@echo "  make setup           - Ensure SDK artifacts + shared package are ready"
	@echo "  make clean           - Remove all build artifacts (force rebuild)"
	@echo "  make list            - List discovered scenarios"
	@echo ""
	@echo "Environment variables:"
	@echo "  BRAINTRUST_TAR           - Path to braintrust tarball (auto-set by parent when running locally)"
	@echo "  BRAINTRUST_OTEL_TAR      - Path to otel tarball (auto-set by parent when running locally)"
	@echo "  SMOKE_V2_SHARED_DIST     - Path to shared package dist (auto-set by parent when running locally)"
	@echo ""
	@echo "Running individual scenarios:"
	@echo "  cd scenarios/otel-v1 && make test   - Runs standalone, builds if needed"
	@echo ""
	@echo "Discovered scenarios:"
	@for scenario in $(SCENARIOS); do echo "  - $$scenario"; done

# =============================================================================
# Setup - Build SDK + shared package
# =============================================================================

setup:
	@echo "==> Setting up smoke-v2"
	@mkdir -p ../artifacts

	@# Build SDK and create tarball if not provided
	@if [ -n "$(BRAINTRUST_TAR)" ] && [ -f "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Using provided BRAINTRUST_TAR: $(BRAINTRUST_TAR)"; \
	else \
		echo "==> Building SDK and creating tarball"; \
		cd ../../.. && pnpm turbo build --filter=braintrust && pnpm --filter=braintrust pack --pack-destination sdk/js/artifacts; \
		\
		for f in sdk/js/artifacts/braintrust-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-latest.tgz" ] && \
			   [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
				cp "$$f" sdk/js/artifacts/braintrust-latest.tgz; \
				break; \
			fi; \
		done; \
	fi

	@# Build shared package if not provided
	@if [ -n "$(SMOKE_V2_SHARED_DIST)" ] && [ -d "$(SMOKE_V2_SHARED_DIST)" ]; then \
		echo "==> Using provided SMOKE_V2_SHARED_DIST: $(SMOKE_V2_SHARED_DIST)"; \
	else \
		if [ ! -d shared/dist ]; then \
			echo "==> Building shared package"; \
			cd shared && npm ci && npm run build; \
		else \
			echo "==> Shared package already built"; \
		fi; \
	fi

# =============================================================================
# Clean - Remove all build artifacts
# =============================================================================

clean:
	@echo "==> Cleaning smoke-v2 artifacts"
	rm -rf ../artifacts/*.tgz
	rm -rf shared/dist shared/node_modules

# =============================================================================
# Test - Run scenarios
# =============================================================================

test:
	@REQUESTED="$(filter-out test,$(MAKECMDGOALS))"; \
	\
	if [ -z "$$REQUESTED" ]; then \
		SCENARIOS_TO_RUN="$(SCENARIOS)"; \
		echo "==> Running all scenarios"; \
	else \
		SCENARIOS_TO_RUN=""; \
		for scenario in $$REQUESTED; do \
			if [ ! -d "scenarios/$$scenario" ]; then \
				echo "Error: Scenario '$$scenario' not found"; \
				echo "Available scenarios:"; \
				for s in $(SCENARIOS); do echo "  - $$s"; done; \
				exit 1; \
			fi; \
			SCENARIOS_TO_RUN="$$SCENARIOS_TO_RUN $$scenario"; \
		done; \
		echo "==> Running scenarios:$$SCENARIOS_TO_RUN"; \
	fi; \
	\
	$(MAKE) setup; \
	\
	: $${BRAINTRUST_TAR:=../artifacts/braintrust-latest.tgz}; \
	: $${BRAINTRUST_OTEL_TAR:=../artifacts/braintrust-otel-latest.tgz}; \
	: $${SMOKE_V2_SHARED_DIST:=shared/dist}; \
	export BRAINTRUST_TAR BRAINTRUST_OTEL_TAR SMOKE_V2_SHARED_DIST; \
	\
	for scenario in $$SCENARIOS_TO_RUN; do \
		echo ""; \
		echo "=== Testing $$scenario ==="; \
		$(MAKE) -C scenarios/$$scenario test || exit 1; \
	done; \
	\
	echo ""; \
	echo "✓ All requested scenarios passed"

# =============================================================================
# List - Show discovered scenarios
# =============================================================================

list:
	@echo "Discovered scenarios:"
	@for scenario in $(SCENARIOS); do echo "  - $$scenario"; done

# =============================================================================
# Make scenario names valid targets (no-ops to support "make test otel-v1")
# =============================================================================

$(SCENARIOS):
	@:
