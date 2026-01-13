/**
 * Eval smoke test suite
 * Tests that Eval can run end-to-end in the current runtime without making real API calls.
 */

import type { EvalFn, TestAdapters, TestResult } from "../helpers/types";
import { assertDefined, assertType } from "../helpers/assertions";

type BraintrustEvalModule = {
  Eval?: EvalFn;
};

function simpleLevenshtein({
  output,
  expected,
}: {
  output: string;
  expected: string;
}) {
  if (!output || !expected) return { name: "levenshtein", score: 0 };
  const s1 = String(output).toLowerCase();
  const s2 = String(expected).toLowerCase();
  if (s1 === s2) return { name: "levenshtein", score: 1 };
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const editDistance = longer.length - shorter.length;
  const similarity = Math.max(0, 1 - editDistance / longer.length);
  return { name: "levenshtein", score: similarity };
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
        scores: [simpleLevenshtein],
      },
      {
        noSendLogs: true,
        returnResults: true,
      },
    );

    // Basic sanity checks to ensure something ran.
    assertDefined(result, "Eval should return a result");

    return {
      success: true,
      testName,
      message: `Eval smoke test passed (${evalData.length} cases)`,
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}
