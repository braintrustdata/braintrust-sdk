SHELL := /bin/bash
ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

.PHONY: install-dev
install-dev:
	mise install

.PHONY: install-deps
install-deps:
	pnpm install

.PHONY: test
test: js-test

.PHONY: lint
lint:
	pnpm run lint

.PHONY: fixup
fixup:
	pnpm run fix

#
# js stuff
#
#

.PHONY: js-build js-test js-docs js-verify-ci

js-build:
	pnpm install --frozen-lockfile
	pnpm run build

js-test: js-build
	# Run tests only for the JS workspace packages and exclude integration scenario tests
	pnpm --filter ./js... run test
	cd js && make test

js-docs: js-build
	cd js && make docs

js-verify-ci: js-docs js-test

js-test-otel-docker:
	@echo "Building Docker images for otel-js tests..."
	@if [ -z "$$NODE_VERSION" ]; then \
		NODE_VER=22; \
	else \
		NODE_VER=$$NODE_VERSION; \
	fi; \
	echo "Building otel-v1 test container..."; \
	docker build -f integrations/otel-js/Dockerfile.test --build-arg NODE_VERSION=$$NODE_VER --build-arg TEST_DIR=otel-v1 -t otel-js-test-v1 . && \
	echo "Building otel-v2 test container..."; \
	docker build -f integrations/otel-js/Dockerfile.test --build-arg NODE_VERSION=$$NODE_VER --build-arg TEST_DIR=otel-v2 -t otel-js-test-v2 .
	@echo "Running otel-v1 tests in Docker container..."
	@docker run --rm otel-js-test-v1
	@echo "Running otel-v2 tests in Docker container..."
	@docker run --rm otel-js-test-v2
	@echo "✅ All otel-js Docker tests passed"


# -------------------------------------------------------------------------------------------------
# Stable release publishing
# Publishes stable release from main branch using git tags
# Usage: make release-js-sdk
# Note: Update version in js/package.json and commit to main before running
# -------------------------------------------------------------------------------------------------
.PHONY: release-js-sdk

release-js-sdk:
	@echo "Publishing stable JS SDK release..."
	@echo "This will create and push a git tag, triggering GitHub Actions to publish to npm."
	@echo ""
	./js/scripts/push-release-tag.sh
