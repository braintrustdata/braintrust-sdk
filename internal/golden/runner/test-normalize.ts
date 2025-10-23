import { Span } from "braintrust";

// Sample trace data for testing
const createSampleTrace = (): Partial<Span>[] => {
  return [
    {
      data: {
        id: "span-1",
        input: {
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "What is 2+2?" },
          ],
        },
        output: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "2+2 equals 4.",
              },
            },
          ],
        },
        metadata: {
          model: "gpt-4",
          temperature: 0.7,
        },
        span_attributes: {
          name: "test-completion",
          type: "llm",
        },
      },
    },
    {
      data: {
        id: "span-2",
        input: "Process user query",
        output: "Query processed successfully",
        metadata: {
          processing_time_ms: 150,
        },
        span_attributes: {
          name: "process-query",
          type: "function",
        },
      },
    },
    {
      data: {
        id: "span-3",
        input: {
          messages: [
            {
              role: "user",
              content: "Can you explain that in more detail?",
            },
          ],
        },
        output: {
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "Of course! When you add 2 + 2, you are combining two groups of 2 items each, resulting in a total of 4 items.",
              },
            },
          ],
        },
        metadata: {
          model: "gpt-4",
          temperature: 0.7,
        },
        span_attributes: {
          name: "follow-up-completion",
          type: "llm",
        },
      },
    },
  ];
};

const testNormalizeEndpoint = async () => {
  console.log("🧪 Testing normalize endpoint with trace data...\n");

  const trace = createSampleTrace();
  console.log(`📊 Created sample trace with ${trace.length} spans`);

  const apiUrl = process.env.BRAINTRUST_API_URL || "http://localhost:3000";
  const baseUrl = `${apiUrl}/api/trace/normalize`;

  // Test 1: Normalize with auto-detect (useLingua: false)
  console.log("\n📝 Test 1: Normalizing with auto-detect...");
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spans: trace,
        options: {
          useLingua: false,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API returned ${response.status}: ${error}`);
    }

    const normalized = await response.json();
    console.log("✅ Auto-detect normalization successful");
    console.log(`   - Returned ${normalized.length} normalized spans`);

    // Check structure of first span
    if (normalized.length > 0) {
      const firstSpan = normalized[0];
      console.log("   - First span structure:");
      console.log(`     - Input normalized: ${firstSpan.input.isNormalized}`);
      console.log(
        `     - Input LLM parseable: ${firstSpan.input.isLLMParseable}`,
      );
      console.log(`     - Output normalized: ${firstSpan.output.isNormalized}`);
      console.log(
        `     - Output LLM parseable: ${firstSpan.output.isLLMParseable}`,
      );
    }
  } catch (error) {
    console.error("❌ Auto-detect normalization failed:", error);
  }

  // Test 2: Normalize with Lingua (useLingua: true)
  console.log("\n📝 Test 2: Normalizing with Lingua...");
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spans: trace,
        options: {
          useLingua: true,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API returned ${response.status}: ${error}`);
    }

    const normalized = await response.json();
    console.log("✅ Lingua normalization successful");
    console.log(`   - Returned ${normalized.length} normalized spans`);

    // Check LLM spans
    const llmSpans = trace.filter(
      (span) => span.data?.span_attributes?.type === "llm",
    );
    console.log(`   - Found ${llmSpans.length} LLM spans in original trace`);

    let llmParseableCount = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (
        trace[i].data?.span_attributes?.type === "llm" &&
        (normalized[i].input.isLLMParseable ||
          normalized[i].output.isLLMParseable)
      ) {
        llmParseableCount++;
      }
    }
    console.log(
      `   - ${llmParseableCount} LLM spans have parseable content after normalization`,
    );
  } catch (error) {
    console.error("❌ Lingua normalization failed:", error);
  }

  // Test 3: Invalid request
  console.log("\n📝 Test 3: Testing error handling with invalid data...");
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Missing 'spans' field
        options: {
          useLingua: false,
        },
      }),
    });

    if (response.ok) {
      console.error("❌ Expected error but request succeeded");
    } else {
      const error = await response.json();
      console.log("✅ Error handling works correctly");
      console.log(`   - Status: ${response.status}`);
      console.log(`   - Error: ${error.error}`);
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }

  console.log("\n✨ Testing complete!");
};

// Run the test if this file is executed directly
if (require.main === module) {
  testNormalizeEndpoint().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { testNormalizeEndpoint, createSampleTrace };
