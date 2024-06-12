import { expect, test } from "@jest/globals";
import { runEvaluator } from "./framework";
import { BarProgressReporter } from "./progress";
import { NumericDiff } from "autoevals";

test("runEvaluator rejects on timeout", async () => {
  await expect(
    runEvaluator(
      null,
      {
        projectName: "proj",
        evalName: "eval",
        data: [{ input: 1, expected: 2 }],
        task: async (input) => {
          await new Promise((r) => setTimeout(r, 100000));
          return input * 2;
        },
        scores: [NumericDiff],
        timeout: 1000,
      },
      new BarProgressReporter(),
      [],
    ),
  ).rejects.toEqual("evaluator timed out");
});

test("runEvaluator works with no timeout", async () => {
  await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [{ input: 1, expected: 2 }],
      task: async (input) => {
        await new Promise((r) => setTimeout(r, 100));
        return input * 2;
      },
      scores: [NumericDiff],
    },
    new BarProgressReporter(),
    [],
  );
});
