import {
  initLogger,
  startSpan,
  withCurrent,
  wrapClaudeAgentSDK,
} from "braintrust";
import type {
  ClaudeAgentSDKHookCallback,
  ClaudeAgentSDKMessage,
} from "../../../js/src/vendor-sdk-types/claude-agent-sdk";
import {
  collectAsync,
  getTestRunId,
  runMain,
  scopedName,
} from "../../helpers/scenario-runtime";

type QueryOptions = {
  hooks?: Record<string, Array<{ hooks: ClaudeAgentSDKHookCallback[] }>>;
  agents?: Record<string, unknown>;
  model?: string;
};

type QueryParams = {
  prompt?: string | AsyncIterable<ClaudeAgentSDKMessage>;
  options?: QueryOptions;
};

function makePromptMessage(content: string): ClaudeAgentSDKMessage {
  return {
    type: "user",
    message: {
      content,
      role: "user",
    },
  };
}

function getHooks(
  options: QueryOptions | undefined,
  eventName: string,
): ClaudeAgentSDKHookCallback[] {
  return (options?.hooks?.[eventName] ?? []).flatMap((entry) => entry.hooks);
}

async function invokeHooks(
  options: QueryOptions | undefined,
  eventName: "PreToolUse" | "PostToolUse" | "PostToolUseFailure",
  input: Parameters<ClaudeAgentSDKHookCallback>[0],
  toolUseId: string,
) {
  const signal = new AbortController().signal;
  for (const hook of getHooks(options, eventName)) {
    await hook(input, toolUseId, { signal });
  }
}

function makeAssistantMessage(args: {
  content: unknown;
  id: string;
  model?: string;
  outputTokens?: number;
  parentToolUseId?: string | null;
}): ClaudeAgentSDKMessage {
  return {
    parent_tool_use_id: args.parentToolUseId ?? null,
    type: "assistant",
    message: {
      content: args.content,
      id: args.id,
      model: args.model ?? "claude-e2e-mock",
      role: "assistant",
      usage: {
        input_tokens: 8,
        output_tokens: args.outputTokens ?? 4,
      },
    },
  };
}

function makeResultMessage(outputTokens = 4): ClaudeAgentSDKMessage {
  return {
    num_turns: 1,
    type: "result",
    usage: {
      input_tokens: 8,
      output_tokens: outputTokens,
    },
  };
}

const mockSDK = {
  query(params: QueryParams) {
    const { options } = params;

    return (async function* () {
      if (options?.agents) {
        const taskToolUseId = "task-tool-1";
        const subToolUseId = "sub-tool-1";

        yield makeAssistantMessage({
          content: [
            {
              id: taskToolUseId,
              input: {
                subagent_type: "math-expert",
              },
              name: "Task",
              type: "tool_use",
            },
          ],
          id: "root-assistant-1",
        });

        yield makeAssistantMessage({
          content: [
            {
              id: subToolUseId,
              input: {
                a: 15,
                b: 27,
                operation: "add",
              },
              name: "mcp__calculator__calculator",
              type: "tool_use",
            },
          ],
          id: "sub-assistant-1",
          parentToolUseId: taskToolUseId,
        });

        await invokeHooks(
          options,
          "PreToolUse",
          {
            cwd: "/tmp",
            hook_event_name: "PreToolUse",
            session_id: "session-subagent",
            tool_input: {
              a: 15,
              b: 27,
              operation: "add",
            },
            tool_name: "mcp__calculator__calculator",
            transcript_path: "/tmp/transcript",
          },
          subToolUseId,
        );

        await invokeHooks(
          options,
          "PostToolUse",
          {
            cwd: "/tmp",
            hook_event_name: "PostToolUse",
            session_id: "session-subagent",
            tool_input: {
              a: 15,
              b: 27,
              operation: "add",
            },
            tool_name: "mcp__calculator__calculator",
            tool_response: {
              content: [{ text: "add(15, 27) = 42", type: "text" }],
            },
            transcript_path: "/tmp/transcript",
          },
          subToolUseId,
        );

        yield makeAssistantMessage({
          content: [{ text: "The answer is 42.", type: "text" }],
          id: "sub-assistant-2",
          parentToolUseId: taskToolUseId,
        });

        await invokeHooks(
          options,
          "PostToolUse",
          {
            cwd: "/tmp",
            hook_event_name: "PostToolUse",
            session_id: "session-subagent",
            tool_input: {
              description: "delegate to math expert",
            },
            tool_name: "Task",
            tool_response: {
              content: "42",
              status: "success",
              totalDurationMs: 1,
              totalToolUseCount: 1,
            },
            transcript_path: "/tmp/transcript",
          },
          taskToolUseId,
        );

        yield makeResultMessage();
        return;
      }

      if (params.prompt && typeof params.prompt !== "string") {
        for await (const _message of params.prompt) {
          // Drain the async iterable prompt so the wrapper captures it as input.
        }

        yield makeAssistantMessage({
          content: [{ text: "Combined async prompt response", type: "text" }],
          id: "async-assistant-1",
        });
        yield makeResultMessage();
        return;
      }

      const toolUseId = "basic-tool-1";

      yield makeAssistantMessage({
        content: [
          {
            id: toolUseId,
            input: {
              a: 15,
              b: 7,
              operation: "multiply",
            },
            name: "mcp__calculator__calculator",
            type: "tool_use",
          },
        ],
        id: "basic-assistant-1",
      });

      await invokeHooks(
        options,
        "PreToolUse",
        {
          cwd: "/tmp",
          hook_event_name: "PreToolUse",
          session_id: "session-basic",
          tool_input: {
            a: 15,
            b: 7,
            operation: "multiply",
          },
          tool_name: "mcp__calculator__calculator",
          transcript_path: "/tmp/transcript",
        },
        toolUseId,
      );

      await invokeHooks(
        options,
        "PostToolUse",
        {
          cwd: "/tmp",
          hook_event_name: "PostToolUse",
          session_id: "session-basic",
          tool_input: {
            a: 15,
            b: 7,
            operation: "multiply",
          },
          tool_name: "mcp__calculator__calculator",
          tool_response: {
            content: [{ text: "multiply(15, 7) = 105", type: "text" }],
          },
          transcript_path: "/tmp/transcript",
        },
        toolUseId,
      );

      yield makeAssistantMessage({
        content: [{ text: "105 minus 5 is 100.", type: "text" }],
        id: "basic-assistant-2",
      });
      yield makeResultMessage();
    })();
  },
  createSdkMcpServer(config: unknown) {
    return config;
  },
  tool<TArgs, TResult>(
    _name: string,
    _description: string,
    _schema: unknown,
    handler: (args: TArgs) => TResult,
  ) {
    return handler;
  },
};

async function main() {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-claude-agent-sdk", testRunId),
  });
  const { query } = wrapClaudeAgentSDK(mockSDK);

  await logger.traced(
    async () => {
      const basicOperation = startSpan({
        name: "claude-agent-basic-operation",
        event: {
          metadata: {
            operation: "basic",
            scenario: "wrap-claude-agent-sdk-traces",
            testRunId,
          },
        },
      });
      await withCurrent(basicOperation, async () => {
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
      basicOperation.end();

      const asyncPromptOperation = startSpan({
        name: "claude-agent-async-prompt-operation",
        event: {
          metadata: {
            operation: "async-prompt",
            scenario: "wrap-claude-agent-sdk-traces",
            testRunId,
          },
        },
      });
      await withCurrent(asyncPromptOperation, async () => {
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
      });
      asyncPromptOperation.end();

      const subAgentOperation = startSpan({
        name: "claude-agent-subagent-operation",
        event: {
          metadata: {
            operation: "subagent",
            scenario: "wrap-claude-agent-sdk-traces",
            testRunId,
          },
        },
      });
      await withCurrent(subAgentOperation, async () => {
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
      });
      subAgentOperation.end();
    },
    {
      name: "claude-agent-sdk-wrapper-root",
      event: {
        metadata: {
          scenario: "wrap-claude-agent-sdk-traces",
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

runMain(main);
