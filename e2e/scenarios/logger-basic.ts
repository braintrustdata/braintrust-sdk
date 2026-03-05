import { initLogger } from "braintrust";

async function main() {
  const testRunId = process.env.BRAINTRUST_E2E_RUN_ID ?? "missing-test-run-id";
  const logger = initLogger({
    projectName: "e2e-project-logs",
  });

  await logger.traced(
    async (rootSpan) => {
      rootSpan.log({
        output: {
          answer: "4",
          explanation: "basic arithmetic",
        },
        metadata: {
          scenario: "logger-basic",
          stage: "root",
          testRunId,
        },
        scores: {
          correct: 1,
        },
      });

      rootSpan.traced(
        (childSpan) => {
          childSpan.log({
            output: {
              detail: "child completed",
            },
            metadata: {
              stage: "child",
              testRunId,
            },
          });
        },
        {
          name: "child-span",
          event: {
            input: {
              step: "child-work",
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
      name: "root-span",
      event: {
        input: {
          question: "What is 2 + 2?",
          testRunId,
        },
        metadata: {
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
