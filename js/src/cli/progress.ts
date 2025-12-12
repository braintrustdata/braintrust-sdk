import chalk from "chalk";
import * as cliProgress from "cli-progress";

import type { ProgressReporter } from "../progress/types";

export type { ProgressReporter } from "../progress/types";
export { SimpleProgressReporter } from "../progress/simple";

const MAX_NAME_LENGTH = 40;

function fitNameToSpaces(name: string, length: number) {
  const padded = name.padEnd(length);
  if (padded.length <= length) {
    return padded;
  }
  return padded.substring(0, length - 3) + "...";
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

  public setTotal(name: string, total: number) {
    this.bars[name].setTotal(total);
  }
}
