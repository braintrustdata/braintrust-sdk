.PHONY: setup test

setup:
	@echo "==> Setting up otel-v1 scenario"
	mise install
	@# Build SDK if tarball doesn't exist
	@if [ ! -f ../../../artifacts/braintrust-latest.tgz ]; then \
		echo "==> Building SDK"; \
		cd ../../.. && pnpm build && mkdir -p artifacts && npm pack --pack-destination artifacts; \
		for f in artifacts/braintrust-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-latest.tgz" ] && [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
				cp "$$f" artifacts/braintrust-latest.tgz; \
				break; \
			fi; \
		done; \
	fi
	@# Build shared package if needed
	@if [ ! -d ../../shared/dist ]; then \
		echo "==> Building shared package"; \
		cd ../../shared && npm ci && npm run build; \
	fi
	@# Build @braintrust/otel if needed (before npm install)
	@if [ ! -f ../../../artifacts/braintrust-otel-latest.tgz ]; then \
		echo "==> Building @braintrust/otel package"; \
		cd ../../../../integrations/otel-js && pnpm build && pnpm pack --pack-destination ../../js/artifacts; \
		for f in ../../js/artifacts/braintrust-otel-*.tgz; do \
			if [ "$$(basename $$f)" != "braintrust-otel-latest.tgz" ]; then \
				cp "$$f" ../../js/artifacts/braintrust-otel-latest.tgz; \
				break; \
			fi; \
		done; \
	fi
	@# Install dependencies (including tarballs from well-known paths)
	npm install

test: setup
	@echo "==> Running otel-v1 tests"
	npx tsx tests/basic.test.ts
	npx tsx tests/filtering.test.ts
	npx tsx tests/shared-suite.test.ts
