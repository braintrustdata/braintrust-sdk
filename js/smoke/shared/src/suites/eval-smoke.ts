/**
 * Eval smoke test suite
 * Tests that Eval can run end-to-end in the current runtime without making real API calls.
 */

import type { EvalFn, TestAdapters, TestResult } from "../helpers/types";
import {
  assertDefined,
  assertEqual,
  assertHasProperty,
  assertType,
} from "../helpers/assertions";

type BraintrustEvalModule = {
  Eval?: EvalFn;
};

// Incredibly simple scorer for smoke tests: exact string match.
// Deterministic, no dependencies, no network/LLM calls.
function exactMatchScore({
  output,
  expected,
}: {
  output: string;
  expected: string;
}) {
  return { name: "exact_match", score: output === expected ? 1 : 0 };
}

/**
 * Run a minimal eval and ensure it completes successfully.
 *
 * Notes:
 * - Uses `noSendLogs: true` to avoid experiment registration / API calls.
 * - Assumes the caller has already set up test state (via setupTestEnvironment / withTestEnvironment).
 */
export async function runEvalSmokeTest(
  _adapters: TestAdapters,
  braintrust: BraintrustEvalModule,
): Promise<TestResult> {
  const testName = "runEvalSmokeTest";

  try {
    assertDefined(braintrust.Eval, "Eval must exist");
    assertType(braintrust.Eval, "function", "Eval must be a function");

    const evalData = [
      { input: "Alice", expected: "Hi Alice" },
      { input: "Bob", expected: "Hi Bob" },
      { input: "Charlie", expected: "Hi Charlie" },
    ];

    // Call signature in the JS SDK is: Eval(name, config, options)
    const result = await braintrust.Eval(
      "smoke-eval-test",
      {
        data: evalData,
        task: async (input: string) => `Hi ${input}`,
        scores: [exactMatchScore],
      },
      {
        noSendLogs: true,
        returnResults: true,
      },
    );

    // Verify result shape + content (similar to js/src/framework.test.ts expectations)
    assertDefined(result, "Eval should return a result");
    const r = result as unknown as Record<string, unknown>;

    assertHasProperty(r, "summary", "Eval result missing summary");
    assertHasProperty(r, "results", "Eval result missing results");

    const summary = r.summary as Record<string, unknown>;
    const results = r.results as Array<Record<string, unknown>>;

    // Per-example results should be retained when returnResults=true
    assertEqual(
      results.length,
      evalData.length,
      `Expected ${evalData.length} eval results`,
    );

    // Validate each result matches expected and has exact_match score = 1
    for (const row of results) {
      assertDefined(row.input, "Eval result missing input");
      assertDefined(row.expected, "Eval result missing expected");
      assertDefined(row.output, "Eval result missing output");
      assertEqual(
        row.output as string,
        row.expected as string,
        "Output should equal expected",
      );

      assertHasProperty(row, "scores", "Eval result missing scores");
      const scores = row.scores as Record<string, unknown>;
      assertDefined(scores.exact_match, "Missing exact_match score");
      assertEqual(scores.exact_match as number, 1, "exact_match should be 1");
    }

    // Validate aggregate score in summary: summary.scores.exact_match.score === 1
    assertHasProperty(summary, "scores", "Summary missing scores");
    const summaryScores = summary.scores as Record<string, unknown>;
    assertHasProperty(
      summaryScores,
      "exact_match",
      "Summary missing exact_match scorer",
    );
    const exact = summaryScores.exact_match as Record<string, unknown>;
    assertDefined(exact.score, "Summary exact_match missing score");
    assertEqual(
      exact.score as number,
      1,
      "Summary exact_match.score should be 1",
    );

    return {
      status: "pass" as const,
      name: testName,
      message: `Eval smoke test passed (${evalData.length} cases)`,
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}
