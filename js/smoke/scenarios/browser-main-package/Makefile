.PHONY: install build test clean

install:
	npm install

build: install
	node esbuild.config.mjs

test: build
	npx playwright test

clean:
	rm -rf node_modules dist package-lock.json
