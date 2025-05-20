.PHONY: lint test test-wheel _template-version clean fixup build verify help _check-git-clean
.PHONY: publish-to-pypi publish-to-testpypi _verify-build-publish install-build-deps install-dev _publish

clean:
	rm -rf build dist

fixup:
	# just run the whole repos fixup (aka pre-commit hooks)
	cd .. && make fixup

lint: fixup
	nox -s pylint

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
	# Ensure pip is at a known version first for reproducible builds
	python -m pip install pip==25.1.1
	# Use 'python -m pip' to ensure we're using python's pip
	# https://pip.pypa.io/en/latest/user_guide/
	python -m pip install -e .
	python -m pip install -r requirements-build.txt

install-dev:
	pip install -e .
	pip install -r requirements-dev.txt

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
