function getHooks(options, eventName) {
  return (options?.hooks?.[eventName] ?? []).flatMap((entry) => entry.hooks);
}

async function invokeHooks(options, eventName, input, toolUseId) {
  const signal = new AbortController().signal;
  for (const hook of getHooks(options, eventName)) {
    await hook(input, toolUseId, { signal });
  }
}

function makeAssistantMessage(args) {
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

function makeResultMessage(outputTokens = 4) {
  return {
    num_turns: 1,
    type: "result",
    usage: {
      input_tokens: 8,
      output_tokens: outputTokens,
    },
  };
}

export function query(params) {
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
      }

      yield makeAssistantMessage({
        content: [{ text: "Combined async prompt response", type: "text" }],
        id: "async-assistant-1",
      });
      yield makeResultMessage();
      return;
    }

    if (typeof params.prompt === "string" && params.prompt.includes("FAIL")) {
      const toolUseId = "failure-tool-1";

      yield makeAssistantMessage({
        content: [
          {
            id: toolUseId,
            input: {
              a: 2,
              b: 0,
              operation: "divide",
            },
            name: "mcp__calculator__calculator",
            type: "tool_use",
          },
        ],
        id: "failure-assistant-1",
      });

      await invokeHooks(
        options,
        "PreToolUse",
        {
          cwd: "/tmp",
          hook_event_name: "PreToolUse",
          session_id: "session-failure",
          tool_input: {
            a: 2,
            b: 0,
            operation: "divide",
          },
          tool_name: "mcp__calculator__calculator",
          transcript_path: "/tmp/transcript",
        },
        toolUseId,
      );

      await invokeHooks(
        options,
        "PostToolUseFailure",
        {
          cwd: "/tmp",
          error: "division by zero",
          hook_event_name: "PostToolUseFailure",
          is_interrupt: false,
          session_id: "session-failure",
          tool_input: {
            a: 2,
            b: 0,
            operation: "divide",
          },
          tool_name: "mcp__calculator__calculator",
          transcript_path: "/tmp/transcript",
        },
        toolUseId,
      );

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
}

export function createSdkMcpServer(config) {
  return config;
}

export function tool(_name, _description, _schema, handler) {
  return handler;
}
