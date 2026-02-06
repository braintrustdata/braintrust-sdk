.PHONY: setup test clean

BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust >/dev/null 2>&1 && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts >/dev/null 2>&1 && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up eval-vitest scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found at $(BRAINTRUST_TAR)"; \
		exit 1; \
	fi
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	@echo "==> Installing dependencies"
	@npm install

test: setup
	@echo "==> Running eval-vitest tests"
	@npm test

clean:
	@echo "==> Cleaning eval-vitest scenario"
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
