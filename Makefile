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
	pnpm run fix:formatting && pnpm run fix:lint

#
# js stuff
#
#

.PHONY: js-build js-test js-test-checks js-test-external js-docs js-verify-checks js-verify-ci

js-build:
	pnpm install --frozen-lockfile
	pnpm run build

js-test-checks: js-build
	cd js && make test-checks

js-test-external: js-build
	cd js && make test-external

js-test: js-test-checks js-test-external

js-docs: js-build
	cd js && make docs

js-verify-checks: js-docs js-test-checks

js-verify-ci: js-verify-checks js-test-external

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
# Preferred: trigger publish-js-sdk.yaml from GitHub Actions UI
# Fallback: make release-js-sdk [BRANCH=<branch>] dispatches the same workflow via gh
# -------------------------------------------------------------------------------------------------
.PHONY: release-js-sdk

release-js-sdk:
	./js/scripts/dispatch-release-workflow.sh
