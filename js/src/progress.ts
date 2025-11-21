import chalk from "chalk";
import * as cliProgress from "cli-progress";

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
  private multiBar: cliProgress.MultiBar;
  private bars: Record<string, cliProgress.SingleBar> = {};

  constructor() {
    this.multiBar = new cliProgress.MultiBar(
      {
        // clearOnComplete: true,
        format: `${chalk.blueBright("{bar}")} ${chalk.blue("{evaluator}")} {percentage}% ${chalk.gray("{value}/{total} {eta_formatted}")}`,
        // autopadding: true,
        hideCursor: true,
        barsize: 10,
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
