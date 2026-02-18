# Temporal + Braintrust Tracing Example (ESM)

This ESM example demonstrates how to run the Temporal + Braintrust tracing example using Node ESM (`tsx` is recommended).

Quick start — run the full example (three terminals):

- **Terminal 1 — Start Temporal dev server:**

```bash
# Start Temporal dev server (requires Temporal CLI or Docker setup)
temporal server start-dev
```

- **Terminal 2 — Prepare the example and build local integration package:**

```bash
cp .env.example .env
npm install
# You can use pnpm for workspace-aware builds. From this example folder:
# install example deps
pnpm install
# build the local integration package so the example uses the local @braintrust/temporal
pnpm run build:integration

# Alternatively, from the repo root you can run:
pnpm --filter @braintrust/temporal build
```

- **Terminal 3 — Run the worker (ESM):**

```bash
# Recommended runner: tsx. Use pnpm scripts added to this example:
# start a worker
pnpm run worker
# start a worker with debug nexus registration
pnpm run worker:debug
# or run directly with npx/tsx:
# npx -y tsx src/worker.ts
```

- **Trigger workflows (in another terminal):**

```bash
pnpm run client
# or direct:
# npx -y tsx src/client.ts
```

Notes and troubleshooting:

- **File references:** worker is at [src/worker.ts](sdk/integrations/temporal-js/examples/temporal-esm/src/worker.ts), the client at [src/client.ts](sdk/integrations/temporal-js/examples/temporal-esm/src/client.ts), and workflows at [src/workflows.ts](sdk/integrations/temporal-js/examples/temporal-esm/src/workflows.ts).
- The example expects the local `@braintrust/temporal` integration to be built (see `pnpm build` step). Building the integration ensures the example uses the local package code.
- Use separate terminals for the Temporal server, worker, and client to observe logs independently.
- This example uses modern Node ESM. `tsx` is recommended as the runtime for a smooth ESM experience; if you prefer `ts-node`, adapt the commands accordingly.

pnpm commands quick reference

```bash
# build the integration (from example or repo root)
pnpm run build:integration

# install example dependencies
pnpm install

# start a single worker
pnpm run worker

# start a worker with debug nexus enabled
pnpm run worker:debug

# run the client to trigger workflows
pnpm run client

# run Procfile via Overmind (server + multiple workers)
pnpm run dev
```

Happy debugging — if you want, I can also add a script to the example `package.json` to run these steps automatically.

Run with mise

This example includes a `mise.toml` with helper tasks. Use `mise` to install tools and run the server/worker/client tasks.

Install mise (if you don't already have it) and run the example tasks:

```bash
# install tools and example deps defined in mise.toml
mise run install

# start temporal server + one worker (use multiple terminals to run more workers)
mise run server

# run the workflow client
mise run workflow

# stop the server/workers
mise run stop

# force kill
mise run kill
```
