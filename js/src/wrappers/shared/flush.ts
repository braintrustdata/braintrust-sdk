import { suppressApplicationLogs } from "../../logs/context";
import type { Experiment } from "../../logger";
import { formatExperimentSummary } from "./format";

/**
 * Summarize and flush an experiment.
 *
 * `summarize()` calls `flush()` internally
 */
export async function summarizeAndFlush(
  experiment: Experiment,
  options: { displaySummary?: boolean },
): Promise<void> {
  const shouldDisplay = options.displaySummary ?? true;
  if (!shouldDisplay) {
    await experiment.flush();
    return;
  }

  const summary = await experiment.summarize();
  suppressApplicationLogs(() => {
    // eslint-disable-next-line no-restricted-properties -- user-requested summary output is independent of SDK diagnostics.
    console.log(formatExperimentSummary(summary));
  });
}
