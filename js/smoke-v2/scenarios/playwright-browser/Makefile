.PHONY: setup test

setup:
	@echo "==> Setting up playwright-browser scenario"
	mise install

	# Build shared test package
	@if [ ! -d ../../shared/dist ]; then \
		cd ../../shared && npm install && npm run build; \
	fi

	# Build SDK if braintrust-latest.tgz doesn't exist
	@if [ ! -f ../../../artifacts/braintrust-latest.tgz ]; then \
		cd ../../.. && pnpm build && npm pack --pack-destination artifacts; \
		for f in artifacts/braintrust-*.tgz; do \
			[ "$$(basename $$f)" = "braintrust-latest.tgz" ] && continue; \
			cp "$$f" artifacts/braintrust-latest.tgz; break; \
		done; \
	fi

	# Install dependencies (tarball paths in package.json)
	npm install

	# Install Playwright browsers
	npx playwright install --with-deps chromium

	# Build browser test bundle
	node esbuild.config.mjs

test: setup
	npx playwright test
