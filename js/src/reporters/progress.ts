import type { ProgressReporter } from "./types";

export class SimpleProgressReporter implements ProgressReporter {
  public start(name: string, _total: number) {
    // eslint-disable-next-line no-restricted-properties -- progress reporters intentionally write to stdout.
    console.log(`Running evaluator ${name}`);
  }
  public stop() {}
  public increment(_name: string) {}
  public setTotal(_name: string, _total: number) {}
}
