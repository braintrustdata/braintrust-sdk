import { setupAutoInstrumentation } from "../src/index";

setupAutoInstrumentation({
  debug: true,
  include: ["openai"],
});

console.log("[Example] Auto-instrumentation setup complete");
console.log(
  "[Example] Now when you import OpenAI, it will be automatically wrapped",
);

import("openai").then((OpenAIModule) => {
  const OpenAI = OpenAIModule.default;
  console.log("[Example] Creating OpenAI client...");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "test-key",
  });

  const isWrapped = (client as any)[Symbol.for("braintrust.wrapped.openai")];
  console.log(
    `[Example] OpenAI client is ${isWrapped ? "✅ WRAPPED" : "❌ NOT WRAPPED"}`,
  );
});
