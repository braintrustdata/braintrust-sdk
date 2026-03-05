import { initExperiment } from "braintrust";

async function main() {
  const testRunId = process.env.BRAINTRUST_E2E_RUN_ID ?? "missing-test-run-id";
  const experiment = initExperiment("e2e-evals", {
    experiment: "logger-e2e",
    metadata: {
      suite: "e2e",
    },
    tags: ["e2e"],
  });

  await experiment.traced(
    async (rootSpan) => {
      rootSpan.log({
        output: {
          completion: "done",
        },
        expected: {
          completion: "done",
        },
        scores: {
          pass: 1,
        },
        metadata: {
          scenario: "experiment-basic",
          record: "sample-1",
          testRunId,
        },
      });

      rootSpan.traced(
        (childSpan) => {
          childSpan.log({
            output: {
              tool: "lookup",
              status: "success",
            },
            metadata: {
              stage: "child",
              testRunId,
            },
          });
        },
        {
          name: "tool-span",
          event: {
            input: {
              tool: "lookup",
              testRunId,
            },
            metadata: {
              testRunId,
            },
          },
        },
      );
    },
    {
      name: "experiment-root",
      event: {
        input: {
          prompt: "Run an evaluation",
          testRunId,
        },
        metadata: {
          testRunId,
        },
      },
    },
  );

  await experiment.flush();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
