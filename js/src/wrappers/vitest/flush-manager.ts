import type { VitestExperimentContext } from "./context-manager";
import type { WrapperConfig } from "./types";
import { summarizeAndFlush } from "../shared/flush";

class FlushCoordinator {
  private activeFlushes = new Map<string, Promise<void>>();

  async coordinateFlush(
    context: VitestExperimentContext | null,
    config: WrapperConfig,
  ): Promise<void> {
    if (!context) return;

    const experimentId = await context.experiment.id;

    if (this.activeFlushes.has(experimentId)) {
      return this.activeFlushes.get(experimentId)!;
    }

    const flushPromise = summarizeAndFlush(context.experiment, {
      displaySummary: config.displaySummary,
    });
    this.activeFlushes.set(experimentId, flushPromise);

    try {
      await flushPromise;
    } finally {
      this.activeFlushes.delete(experimentId);
    }
  }
}

const flushCoordinator = new FlushCoordinator();

export async function flushExperimentWithSync(
  context: VitestExperimentContext | null,
  config: WrapperConfig,
): Promise<void> {
  return flushCoordinator.coordinateFlush(context, config);
}
