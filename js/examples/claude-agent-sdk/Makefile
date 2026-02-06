.PHONY: run run-async-iter clean

run:
	cd ../.. && pnpm build && ./node_modules/.bin/tsx examples/claude-agent-sdk/index.ts

run-async-iter:
	cd ../.. && pnpm build && ./node_modules/.bin/tsx examples/claude-agent-sdk/async_iter.ts

clean:
	rm -rf node_modules
