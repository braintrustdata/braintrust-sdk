.PHONY: lint test test-wheel _template-version clean fixup build verify help _check-git-clean
.PHONY: publish-to-pypi publish-to-testpypi _verify-build-publish install-build-deps _publish

clean:
	rm -rf build dist

fixup:
	# just run the whole repos fixup (aka pre-commit hooks)
	cd .. && make fixup

lint: fixup
	@pylint --errors-only $(shell git ls-files '**/*.py')

test:
	nox -x

test-wheel: build
	nox -x -- --wheel

_template-version:
	@bash scripts/template-version.sh

build: clean _template-version
	python -m build
	# Restore the original version file after the build
	git checkout src/braintrust/version.py

verify: lint test

install-build-deps:
	# FIXME[matt] build dependencies should be pinned (e.g. build,
	# setuptools, twine) to ensure reproducible builds.
	python -m pip install -e .[all]
	python -m pip install --upgrade pip setuptools build twine pylint nox pre-commit

install-dev:
	pip install -e .[all]
	pip install pylint

_publish:
	./scripts/publish.sh

_check-git-clean:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: Git working directory is not clean. Won't run publish."; \
		exit 1; \
	fi

_verify-build-publish: _check-git-clean lint build test-wheel _publish
publish-to-pypi: export PYPI_REPO := pypi
publish-to-pypi: _verify-build-publish

publish-to-testpypi: export PYPI_REPO := testpypi
publish-to-testpypi: _verify-build-publish

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
	@echo "  test-wheel          - Run tests against built wheel"
	@echo "  verify              - Run all CI checks"
	@echo "  publish-to-pypi     - Publish to PyPI"
	@echo "  publish-to-testpypi - Publish to TestPyPI"
