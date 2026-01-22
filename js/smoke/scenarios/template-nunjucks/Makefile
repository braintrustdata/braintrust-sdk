.PHONY: setup test

# =============================================================================
# Setup
# =============================================================================

setup:
	@echo "==> Setting up template-nunjucks scenario"
	mise install

	@# Check if BRAINTRUST_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_TAR)" ]; then \
		echo "==> Using BRAINTRUST_TAR: $(BRAINTRUST_TAR)"; \
	else \
		echo "==> Building SDK"; \
		cd ../../.. && pnpm exec turbo build --filter=braintrust && mkdir -p artifacts && pnpm pack --pack-destination artifacts; \
		\
		for f in artifacts/braintrust-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-latest.tgz" ] && \
			   [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ] && \
			   [ "$$(basename $$f)" != "braintrust-template-nunjucks-latest.tgz" ]; then \
				cp "$$f" artifacts/braintrust-latest.tgz; \
				break; \
			fi; \
		done; \
	fi

	@# Build shared package (if not running from parent)
	@if [ -z "$(SMOKE_V2_SHARED_DIST)" ]; then \
		echo "==> Building shared package"; \
		cd ../../shared && npm ci && npm run build; \
	fi

	@# Check if BRAINTRUST_TEMPLATE_NUNJUCKS_TAR is set (from parent or CI), otherwise build
	@if [ -n "$(BRAINTRUST_TEMPLATE_NUNJUCKS_TAR)" ]; then \
		echo "==> Using BRAINTRUST_TEMPLATE_NUNJUCKS_TAR: $(BRAINTRUST_TEMPLATE_NUNJUCKS_TAR)"; \
	else \
		echo "==> Building @braintrust/template-nunjucks package"; \
		cd ../../../../integrations/template-nunjucks && pnpm exec turbo build --filter=@braintrust/template-nunjucks && pnpm pack --pack-destination ../../js/artifacts; \
		\
		for f in ../../js/artifacts/braintrust-template-nunjucks-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-template-nunjucks-latest.tgz" ]; then \
				cp "$$f" ../../js/artifacts/braintrust-template-nunjucks-latest.tgz; \
				break; \
			fi; \
		done; \
	fi

	npm install --no-package-lock

# =============================================================================
# Test
# =============================================================================

test: setup
	@echo "==> Running template-nunjucks tests"
	npx tsx tests/basic.test.ts
