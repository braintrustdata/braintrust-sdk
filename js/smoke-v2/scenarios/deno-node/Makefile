.PHONY: setup test

setup:
	@echo "==> Setting up deno-node scenario"
	mise install
	deno install

test: setup
	deno test --sloppy-imports --allow-all tests/*.test.ts
