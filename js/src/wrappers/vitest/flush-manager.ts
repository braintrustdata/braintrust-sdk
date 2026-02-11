import type { VitestExperimentContext } from "./context-manager";
import type { WrapperConfig } from "./types";
import { formatExperimentSummary } from "./wrapper";

class FlushCoordinator {
  private activeFlushes = new Map<string, Promise<void>>();

  async coordinateFlush(
    context: VitestExperimentContext | null,
    config: WrapperConfig,
  ): Promise<void> {
    if (!context) return;

    const experimentId = context.experiment.id;

    if (this.activeFlushes.has(experimentId)) {
      return this.activeFlushes.get(experimentId)!;
    }

    const flushPromise = this.doFlush(context, config);
    this.activeFlushes.set(experimentId, flushPromise);

    try {
      await flushPromise;
    } finally {
      this.activeFlushes.delete(experimentId);
    }
  }

  private async doFlush(
    context: VitestExperimentContext,
    config: WrapperConfig,
  ): Promise<void> {
    let summary;
    try {
      summary = await context.experiment.summarize();
    } catch (error) {
      console.warn("Failed to generate experiment summary:", error);
    }

    try {
      await context.experiment.flush();
    } catch (error) {
      console.warn("Failed to flush experiment:", error);
      throw error;
    }

    if (summary && (config.displaySummary ?? true)) {
      console.log(formatExperimentSummary(summary));
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
