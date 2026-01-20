.PHONY: setup test

setup:
	@echo "==> Setting up deno-browser scenario"
	mise install
	deno install

test: setup
	deno test --sloppy-imports --allow-all tests/*.test.ts
