.PHONY: lint test test-wheel _template-version clean fixup build verify-build verify help install-build-deps install-dev _check-git-clean

clean:
	rm -rf build dist

fixup:
	# just run the whole repos fixup (aka pre-commit hooks)
	cd .. && make fixup

lint: fixup
	nox -s pylint

test:
	nox -x

test-wheel:
	# This target runs a small set of sanity checks before we release our
	# build artifact to pypi. We skip running the full test suite because
	# (a) theoretically it should have been run before (b) it has
	# integration tests and we don't want to block the release because
	# some service is down, etc. This decision could be revisited anytime.
	# Note: Caller must run 'make build' first.
	nox -s test_core -- --wheel

test-core:
	nox -s test_core

_template-version:
	@bash scripts/template-version.sh

build: clean _template-version
	python -m build
	# Restore the original version file after the build
	git checkout src/braintrust/version.py

_check-git-clean:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Git working directory is not clean."; \
		exit 1; \
	fi

verify-build: _check-git-clean build test-wheel

verify: lint test

install-build-deps:
	python -m pip install uv==0.7.8
	python -m uv pip install -e .
	python -m uv pip install -r requirements-build.txt

install-dev: install-build-deps
	python -m uv pip install -r requirements-dev.txt

install-optional: install-dev
	python -m uv pip install anthropic openai pydantic_ai litellm agno google-genai google-adk dspy langsmith
	python -m uv pip install -e .[temporal,otel]

.DEFAULT_GOAL := help
help:
	@echo "Available targets:"
	@echo "  build               - Build Python package"
	@echo "  clean               - Remove build artifacts"
	@echo "  help                - Show this help message"
	@echo "  install-build-deps  - Install build dependencies for CI"
	@echo "  install-dev         - Install package in development mode with all dependencies"
	@echo "  lint                - Run pylint checks"
	@echo "  test                - Run all tests"
	@echo "  test-core           - Run core tests only"
	@echo "  test-wheel          - Run tests against built wheel"
	@echo "  verify              - Run all CI checks"
	@echo "  verify-build        - Verify git clean, build, and test wheel"
