import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "./provider-runtime.mjs";

function makePromptMessage(content) {
  return {
    type: "user",
    message: {
      content,
      role: "user",
    },
  };
}

export async function runClaudeAgentSDKScenario(options) {
  const sdk = options.decorateSDK
    ? options.decorateSDK(options.sdk)
    : options.sdk;
  const { query } = sdk;

  await runTracedScenario({
    callback: async () => {
      await runOperation("claude-agent-basic-operation", "basic", async () => {
        await collectAsync(
          query({
            prompt:
              "Use the calculator tool to multiply 15 by 7, then subtract 5.",
            options: {
              model: "claude-e2e-mock",
            },
          }),
        );
      });

      await runOperation(
        "claude-agent-async-prompt-operation",
        "async-prompt",
        async () => {
          await collectAsync(
            query({
              prompt: (async function* () {
                yield makePromptMessage("Part 1");
                yield makePromptMessage("Part 2");
              })(),
              options: {
                model: "claude-e2e-mock",
              },
            }),
          );
        },
      );

      await runOperation(
        "claude-agent-subagent-operation",
        "subagent",
        async () => {
          await collectAsync(
            query({
              prompt: "Spawn a math-expert subagent and report the result.",
              options: {
                agents: {
                  "math-expert": {
                    description: "Math specialist",
                  },
                },
                model: "claude-e2e-mock",
              },
            }),
          );
        },
      );

      await runOperation(
        "claude-agent-failure-operation",
        "failure",
        async () => {
          await collectAsync(
            query({
              prompt: "FAIL the calculator tool call.",
              options: {
                model: "claude-e2e-mock",
              },
            }),
          );
        },
      );
    },
    metadata: {
      scenario: options.scenarioName,
    },
    projectNameBase: options.projectNameBase,
    rootName: options.rootName,
  });
}
