import type { Span } from "../../logger";
import type { Score, ScorerFunction } from "./types";

export async function runScorers(args: {
  scorers: ScorerFunction[];
  output: unknown;
  expected: unknown;
  input: unknown;
  metadata: Record<string, unknown> | undefined;
  span: Span;
}): Promise<void> {
  const { scorers, output, expected, input, metadata, span } = args;

  const scorerArgs = {
    output,
    expected,
    input,
    metadata: metadata || {},
  };

  for (const scorer of scorers) {
    try {
      const result = await scorer(scorerArgs);
      const scores = normalizeScores(result);

      for (const score of scores) {
        if (score.metadata && Object.keys(score.metadata).length > 0) {
          span.log({
            scores: { [score.name]: score.score },
            metadata: score.metadata,
          });
        } else {
          span.log({
            scores: { [score.name]: score.score },
          });
        }
      }
    } catch (scorerError) {
      // Log scorer error but don't fail test
      console.warn("Braintrust: Scorer failed:", scorerError);
      span.log({
        metadata: {
          scorer_error:
            scorerError instanceof Error
              ? { message: scorerError.message, name: scorerError.name }
              : String(scorerError),
        },
      });
    }
  }
}

function normalizeScores(result: unknown): Score[] {
  if (result === null || result === undefined) {
    return [];
  }

  if (typeof result === "number") {
    return [{ name: "score", score: result }];
  }

  if (Array.isArray(result)) {
    return result.filter((s) => s !== null && s !== undefined);
  }

  if (typeof result === "object" && "name" in result && "score" in result) {
    return [result as Score];
  }

  return [];
}
