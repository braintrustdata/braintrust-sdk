import { suppressApplicationLogs } from "../logs/context";
import type { ProgressReporter } from "./types";

export class SimpleProgressReporter implements ProgressReporter {
  public start(name: string, _total: number) {
    suppressApplicationLogs(() => {
      // eslint-disable-next-line no-restricted-properties -- user-facing progress output is independent of SDK diagnostics.
      console.log(`Running evaluator ${name}`);
    });
  }
  public stop() {}
  public increment(_name: string) {}
  public setTotal(_name: string, _total: number) {}
}
