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
	rm -rf venv && python3 -m venv venv
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

.PHONY: test test-py test-js

test: test-py test-js

test-js:
	pnpm test

test-py:
	python -m unittest discover py/tests
