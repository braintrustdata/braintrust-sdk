// Conditional import for cli-progress (Node.js-only)
let cliProgress: any;
try {
  cliProgress = require("cli-progress");
} catch {
  // In edge/browser environments, cli-progress is not available
  // BarProgressReporter should not be used in these environments
  cliProgress = null;
}

const MAX_NAME_LENGTH = 40;

function fitNameToSpaces(name: string, length: number) {
  const padded = name.padEnd(length);
  if (padded.length <= length) {
    return padded;
  }
  return padded.substring(0, length - 3) + "...";
}

export interface ProgressReporter {
  start: (name: string, total: number) => void;
  stop: () => void;
  increment: (name: string) => void;
}

export class SimpleProgressReporter implements ProgressReporter {
  public start(name: string, _total: number) {
    console.log(`Running evaluator ${name}`);
  }
  public stop() {}
  public increment(_name: string) {}
}

export class BarProgressReporter implements ProgressReporter {
  private multiBar: any; // cliProgress.MultiBar (typed as any for conditional import)
  private bars: Record<string, any> = {}; // Record<string, cliProgress.SingleBar>

  constructor() {
    if (!cliProgress) {
      throw new Error(
        "BarProgressReporter requires cli-progress which is only available in Node.js environments. " +
          "Use SimpleProgressReporter in edge/browser environments instead.",
      );
    }
    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        format:
          " {bar} | {evaluator} | {percentage}% | {value}/{total} datapoints",
        autopadding: true,
      },
      cliProgress.Presets.shades_grey,
    );
  }

  public start(name: string, total: number) {
    const bar = this.multiBar.create(total, 0);
    this.bars[name] = bar;
  }

  public stop() {
    this.multiBar.stop();
  }

  public increment(name: string) {
    this.bars[name].increment({
      evaluator: fitNameToSpaces(name, MAX_NAME_LENGTH),
    });
  }
}
