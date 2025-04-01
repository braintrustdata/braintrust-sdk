import { initLogger, traced } from "braintrust";

const logger = initLogger({ projectName: "example-tracing" });

async function someLLMFunction(input: string) {
  return traced(async (span) => {
    const output = invokeLLM(input);
    span.log({ input, output });
  });
}
