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
	bash -c 'source venv/bin/activate && python -m pip install -e core/py'
	bash -c 'source venv/bin/activate && python -m pip install -e py[all]'
	@touch $@

${VENV_PRE_COMMIT}: ${VENV_PYTHON_PACKAGES}
	bash -c 'source venv/bin/activate && pre-commit install'
	@touch $@

develop: ${VENV_PRE_COMMIT}
	@echo "--\nRun "source env.sh" to enter development mode!"

fixup:
	source env.sh && pre-commit run --all-files

.PHONY: test test-py test-js nox pylint template-version template-version-rc

test: test-py-core test-py-sdk test-js

test-py-core:
	source env.sh && python -m unittest discover ./core/py/src

test-py-sdk: nox
	source env.sh && cd py && pytest

test-js:
	pnpm install && pnpm test

nox:
	nox -f py/noxfile.py -k code
	nox -f integrations/langchain-py/noxfile.py

pylint:
	@pylint --errors-only $(shell git ls-files 'py/**/*.py')

#----------------------
# Python SDK
#----------------------

.PHONY: py-sdk-build py-sdk-lint py-sdk-verify py-sdk-test-code py-sdk-test-wheel py-sdk-build-and-test
.PHONY: py-sdk-build-test-publish-testpypi py-sdk-build-test-publish-pypi update-sdk-version-py

py-sdk-lint:
	@pylint --errors-only py/src py/examples

# Build our wheel with the current git commit hash baked in.
py-sdk-build: update-sdk-version-py
	rm -rf py/dist
	cd py && python -m build
	git checkout py/src/braintrust/version.py

# Run all tests against the current source.
py-sdk-test-code:
	nox -f py/noxfile.py -k code

# Run all tests against the most recently built wheel.
py-sdk-test-wheel:
	nox -f py/noxfile.py -k wheel

# do everything the ci needs to do to check our code
py-sdk-verify-ci: fixup py-sdk-lint py-sdk-test-code

py-sdk-publish:
	@if [ -z "$$PYPI_REPO" ]; then \
		echo "Error: PYPI_REPO environment variable must be set"; \
		exit 1; \
	fi

	cd py && twine upload --repository ${PYPI_REPO} dist/*

update-sdk-version-py:
	@bash template-version.sh

# Build test and publish the wheel.
py-sdk-build-test-publish: py-sdk-build py-sdk-test-wheel py-sdk-publish

# Build, test and publish to pypi.
# NOTE[matt] all repos will be testpypi until this script is well
# tested.
py-sdk-build-test-publish-pypi: export PYPI_REPO=testpypi
py-sdk-build-test-publish-pypi: py-sdk-build-test-publish

py-sdk-build-test-publish-testpypi: export PYPI_REPO=testpypi
py-sdk-build-test-publish-testpypi: py-sdk-build-test-publish
