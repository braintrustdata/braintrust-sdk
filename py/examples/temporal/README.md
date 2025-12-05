# Braintrust Temporal Tracing Example

This example demonstrates distributed tracing for Temporal workflows using Braintrust.

## Setup

1. Install Braintrust with Temporal support:

   ```bash
   pip install "braintrust[temporal]"
   ```

   Or if using mise:

   ```bash
   mise install
   ```

2. Configure your Braintrust API key in `.env`:
   ```bash
   cp .env.example .env
   # Edit .env and add your BRAINTRUST_API_KEY
   ```

## Running

1. Start the Temporal server and workers:

   ```bash
   mise run server
   ```

2. In another terminal, run the workflow:

   ```bash
   mise run workflow
   ```

   Optional: Send a signal during workflow execution:

   ```bash
   mise run workflow -- --signal
   ```
