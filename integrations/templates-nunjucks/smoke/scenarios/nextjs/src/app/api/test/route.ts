import { NextResponse } from "next/server";
import * as braintrust from "braintrust";
import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";

// Force Node.js runtime (not edge)
export const runtime = "nodejs";

// Register plugin
braintrust.registerTemplatePlugin(nunjucksPlugin);

export async function GET() {
  try {
    const results = [];

    // Test 1: Basic nunjucks template rendering
    const prompt = new braintrust.Prompt(
      {
        id: "test-prompt-1",
        _xact_id: "test-xact",
        project_id: "test-project",
        name: "nunjucks-nextjs-test",
        slug: "nunjucks-nextjs-test",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content:
                  "Items: {% for item in items %}{{ item.name }}{% if not loop.last %}, {% endif %}{% endfor %}",
              },
            ],
          },
          options: { model: "gpt-4" },
        },
      },
      {},
      false,
    );

    const result = prompt.build(
      { items: [{ name: "apple" }, { name: "banana" }, { name: "cherry" }] },
      { templateFormat: "nunjucks" },
    );

    if (result.messages[0]?.content === "Items: apple, banana, cherry") {
      results.push({
        status: "pass",
        name: "Nunjucks template loop rendering",
      });
    } else {
      results.push({
        status: "fail",
        name: "Nunjucks template loop rendering",
        error: {
          message: `Expected "Items: apple, banana, cherry", got "${result.messages[0]?.content}"`,
        },
      });
    }

    // Test 2: Conditional rendering
    const conditionalPrompt = new braintrust.Prompt(
      {
        id: "test-prompt-2",
        _xact_id: "test-xact",
        project_id: "test-project",
        name: "nunjucks-conditional-test",
        slug: "nunjucks-conditional-test",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content:
                  "{% if showGreeting %}Hello, {{ name }}!{% else %}Goodbye!{% endif %}",
              },
            ],
          },
          options: { model: "gpt-4" },
        },
      },
      {},
      false,
    );

    const conditionalResult = conditionalPrompt.build(
      { showGreeting: true, name: "World" },
      { templateFormat: "nunjucks" },
    );

    if (conditionalResult.messages[0]?.content === "Hello, World!") {
      results.push({
        status: "pass",
        name: "Nunjucks conditional rendering",
      });
    } else {
      results.push({
        status: "fail",
        name: "Nunjucks conditional rendering",
        error: {
          message: `Expected "Hello, World!", got "${conditionalResult.messages[0]?.content}"`,
        },
      });
    }

    const failures = results.filter((r) => r.status === "fail");

    return NextResponse.json(
      {
        success: failures.length === 0,
        message:
          failures.length > 0
            ? `${failures.length} test(s) failed`
            : "All tests passed",
        content: result.messages[0]?.content,
        totalTests: results.length,
        passedTests: results.filter((r) => r.status === "pass").length,
        failedTests: failures.length,
        results,
      },
      { status: failures.length === 0 ? 200 : 500 },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
