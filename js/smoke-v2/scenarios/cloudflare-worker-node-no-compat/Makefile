.PHONY: setup test

setup:
	@echo "==> Setting up cloudflare-worker-node-no-compat"
	mise install

	# Build SDK if tarball doesn't exist
	@if [ ! -f ../../../artifacts/braintrust-latest.tgz ]; then \
		cd ../../.. && pnpm build && npm pack --pack-destination artifacts; \
		for f in artifacts/braintrust-*.tgz; do \
			[ "$$(basename $$f)" = "braintrust-latest.tgz" ] && continue; \
			cp "$$f" artifacts/braintrust-latest.tgz; break; \
		done; \
	fi

	# Build shared package if needed
	@if [ ! -d ../../shared/dist ]; then \
		cd ../../shared && npm ci && npm run build; \
	fi

	npm install

test: setup
	@echo "==> Running cloudflare-worker-node-no-compat tests"
	npx tsx tests/worker.test.mjs
