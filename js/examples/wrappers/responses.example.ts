import { initLogger, wrapOpenAI, wrapTraced } from "../../dist/index.js";
import { OpenAI } from "openai";

// tsc && node --env-file=.env script.js
(async () => {
  // Initialize the logger and OpenAI client
  const logger = initLogger({
    projectName: "bifbof",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  const client = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

  // Function to classify text as a question or statement
  const classifyText = wrapTraced(async (input: string) => {
    const completions_response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Classify the following text as a question or a statement.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: input,
            },
          ],
        },
      ],
    });

    const responses_response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: input,
            },
          ],
        },
      ],
      instructions: "Classify the following text as a question or a statement.",
    });

    // Extract the classification from the response
    return {
      "chat.completions": completions_response.choices[0].message.content,
      responses:
        responses_response.output_text || "Unable to classify the input.",
    };
  });

  // Main function to call and log the result
  async function main() {
    const input = "Is this a question?";
    try {
      const result = await classifyText(input);
      console.log("Classification:", result);
    } catch (error) {
      console.error("Error:", error);
    }
  }

  await main().catch(console.error);
  await logger.flush();
})();
