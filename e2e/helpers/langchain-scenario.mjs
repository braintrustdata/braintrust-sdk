import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "./provider-runtime.mjs";

const OPENAI_MODEL = "gpt-4o-mini";

export async function runLangchainScenario(options) {
  const { ChatOpenAI } = options.chatOpenAI;
  const { ChatPromptTemplate } = options.prompts;
  const { HumanMessage, AIMessage, ToolMessage } = options.messages;
  const { DynamicStructuredTool } = options.tools;
  const { z } = options.zod;
  const { BraintrustCallbackHandler } = options.braintrustLangchain;

  await runTracedScenario({
    callback: async ({ testRunId }) => {
      // The handler attaches as a child of the current traced span via
      // the parent option, which resolves to currentSpan() inside the
      // traced callback provided by runTracedScenario.
      const handler = new BraintrustCallbackHandler();

      // --- invoke ---
      await runOperation("langchain-invoke-operation", "invoke", async () => {
        const model = new ChatOpenAI({
          model: OPENAI_MODEL,
          maxTokens: 16,
          temperature: 0,
          callbacks: [handler],
        });
        await model.invoke([new HumanMessage("Reply with exactly OK.")]);
      });

      // --- chain (prompt | model) ---
      await runOperation("langchain-chain-operation", "chain", async () => {
        const model = new ChatOpenAI({
          model: OPENAI_MODEL,
          maxTokens: 32,
          temperature: 0,
        });
        const prompt = ChatPromptTemplate.fromTemplate(
          "Reply with the single word {word} and nothing else.",
        );
        const chain = prompt.pipe(model);
        await chain.invoke({ word: "PARIS" }, { callbacks: [handler] });
      });

      // --- streaming ---
      await runOperation("langchain-stream-operation", "stream", async () => {
        const model = new ChatOpenAI({
          model: OPENAI_MODEL,
          maxTokens: 32,
          temperature: 0,
          streaming: true,
          callbacks: [handler],
        });
        const stream = await model.stream([
          new HumanMessage(
            "Count from 1 to 3 and include the words one two three.",
          ),
        ]);
        await collectAsync(stream);
      });

      // --- tool use ---
      await runOperation("langchain-tool-operation", "tool", async () => {
        const getWeatherTool = new DynamicStructuredTool({
          name: "get_weather",
          description: "Get the current weather in a given location",
          schema: z.object({
            location: z
              .string()
              .describe("The city and state or city and country"),
          }),
          func: async ({ location }) => {
            return JSON.stringify({
              condition: "sunny",
              location,
              temperatureC: 22,
            });
          },
        });

        const model = new ChatOpenAI({
          model: OPENAI_MODEL,
          maxTokens: 128,
          temperature: 0,
          callbacks: [handler],
        });
        const modelWithTools = model.bindTools([getWeatherTool]);
        await modelWithTools.invoke(
          "Use the get_weather tool for Paris, France. Do not answer from memory.",
        );
      });

      // --- tool use with result (multi-turn) ---
      await runOperation(
        "langchain-tool-result-operation",
        "tool-result",
        async () => {
          const calculateTool = new DynamicStructuredTool({
            name: "calculate",
            description: "Perform a mathematical calculation",
            schema: z.object({
              operation: z.enum(["add", "subtract", "multiply", "divide"]),
              a: z.number(),
              b: z.number(),
            }),
            func: async ({ operation, a, b }) => {
              const ops = {
                add: a + b,
                subtract: a - b,
                multiply: a * b,
                divide: b !== 0 ? a / b : 0,
              };
              return String(ops[operation]);
            },
          });

          const model = new ChatOpenAI({
            model: OPENAI_MODEL,
            maxTokens: 128,
            temperature: 0,
            callbacks: [handler],
          });
          const modelWithTools = model.bindTools([calculateTool]);

          // First turn: model asks to use the tool
          const firstResult = await modelWithTools.invoke(
            "What is 127 multiplied by 49? Use the calculate tool.",
          );

          if (firstResult.tool_calls && firstResult.tool_calls.length > 0) {
            const toolCall = firstResult.tool_calls[0];
            const result = String(127 * 49);

            // Second turn: send tool result back
            await modelWithTools.invoke([
              new HumanMessage(
                "What is 127 multiplied by 49? Use the calculate tool.",
              ),
              new AIMessage({ content: "", tool_calls: [toolCall] }),
              new ToolMessage({
                content: result,
                tool_call_id: toolCall.id,
              }),
            ]);
          }
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
