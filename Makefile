SHELL := /bin/bash
ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
VENV_PRE_COMMIT := ${ROOT_DIR}/venv/.pre_commit
VENV_DOCS_REBUILD := ${ROOT_DIR}/venv/.docs_rebuild

.PHONY: all
all: ${VENV_PRE_COMMIT}

.PHONY: py
py: ${VENV_PYTHON_PACKAGES}
	bash -c 'source venv/bin/activate'

VENV_INITIALIZED := venv/.initialized

${VENV_INITIALIZED}:
	rm -rf venv && python -m venv venv
	@touch ${VENV_INITIALIZED}

VENV_PYTHON_PACKAGES := venv/.python_packages

${VENV_PYTHON_PACKAGES}: ${VENV_INITIALIZED}
	bash -c 'source venv/bin/activate && python -m pip install --upgrade pip setuptools'
	bash -c 'source venv/bin/activate && python -m pip install -e py[all]'
	@touch $@

${VENV_PRE_COMMIT}: ${VENV_PYTHON_PACKAGES}
	bash -c 'source venv/bin/activate && pre-commit install'
	@touch $@

develop: ${VENV_PRE_COMMIT}
	@echo "--\nRun "source env.sh" to enter development mode!"

fixup:
	source env.sh && pre-commit run --all-files

.PHONY: test test-py test-js nox pylint

test: test-py-core test-py-sdk test-js

test-py-core:
	source env.sh && python -m unittest discover ./core/py/src

test-py-sdk: nox
	source env.sh && cd py && pytest


nox:
	cd py && make test

pylint:
	cd py && make lint


#
# js stuff
#
#

.PHONY: js-build js-test js-docs js-verify-ci

js-build:
	pnpm install --frozen-lockfile
	pnpm run build

js-test: js-build
	pnpm run test
	cd js && make test

js-docs: js-build
	cd js && make docs

js-verify-ci: js-docs js-test


# -------------------------------------------------------------------------------------------------
# Stable release publishing
# Publishes stable release from main branch using git tags
# Usage: make publish-js-sdk
# Note: Update version in js/package.json and commit to main before running
# -------------------------------------------------------------------------------------------------
.PHONY: publish-js-sdk

publish-js-sdk:
	@echo "Publishing stable JS SDK release..."
	@echo "This will create and push a git tag, triggering GitHub Actions to publish to npm."
	@echo ""
	./scripts/push-release-tag.sh

# -------------------------------------------------------------------------------------------------
# Pre-release publishing
# Can publish locally or trigger GitHub Actions workflow
# Usage: make publish-js-sdk-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>
# -------------------------------------------------------------------------------------------------
.PHONY: publish-js-sdk-prerelease

# Default values
TYPE ?= alpha
BUMP ?= prerelease

publish-js-sdk-prerelease:
	@if [ -z "$(MODE)" ] || ! echo "$(MODE)" | grep -qE '^(local|gh)$$'; then \
		echo ""; \
		echo "ERROR: MODE must be either 'local' or 'gh'"; \
		echo ""; \
		echo "Got: MODE=$(MODE)"; \
		echo ""; \
		echo "Usage: make publish-js-sdk-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make publish-js-sdk-prerelease MODE=local TYPE=beta BUMP=prerelease   - Publish locally"; \
		echo "  make publish-js-sdk-prerelease MODE=gh TYPE=alpha BUMP=prepatch       - Trigger GitHub Actions"; \
		echo ""; \
		exit 1; \
	fi
	@if [ -z "$(TYPE)" ]; then \
		echo "ERROR: TYPE parameter is required"; \
		echo "Usage: make publish-js-sdk-prerelease MODE=<local|gh> TYPE=<beta|alpha|rc> BUMP=<prerelease|prepatch|preminor|premajor>"; \
		exit 1; \
	fi
	@if ! echo "$(TYPE)" | grep -qE '^(beta|alpha|rc)$$'; then \
		echo "ERROR: TYPE must be one of: beta, alpha, rc"; \
		exit 1; \
	fi
	@if ! echo "$(BUMP)" | grep -qE '^(prerelease|prepatch|preminor|premajor)$$'; then \
		echo "ERROR: BUMP must be one of: prerelease, prepatch, preminor, premajor"; \
		exit 1; \
	fi
	@if [ "$(MODE)" = "local" ]; then \
		echo "Publishing $(TYPE) pre-release locally ($(BUMP))..."; \
		./scripts/publish-prerelease.sh $(TYPE) $(BUMP); \
	else \
		echo "Triggering GitHub Actions workflow to publish $(TYPE) pre-release ($(BUMP))..."; \
		gh workflow run publish-js-sdk-prerelease.yaml \
			-f prerelease_type=$(TYPE) \
			-f version_bump=$(BUMP); \
		echo "Workflow triggered! Check status at:"; \
		echo "https://github.com/braintrustdata/braintrust-sdk/actions/workflows/publish-js-sdk-prerelease.yaml"; \
	fi
