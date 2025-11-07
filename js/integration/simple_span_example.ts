import { initLogger } from "braintrust";

async function main() {
  const logger = initLogger({ projectName: "otel-simple-example" });

  const span = logger.startSpan({ name: "logger.simple" });
  span.log({
    input: "What is the capital of France?",
    output: "Paris",
    expected: "Paris",
    metadata: { model: "gpt-4o-mini" },
  });
  span.end();

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

main().catch((error) => {
  console.error("Simple OTEL example failed:", error);
  process.exitCode = 1;
});
