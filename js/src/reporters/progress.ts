import { sdkConsole } from "../logs/console";
import type { ProgressReporter } from "./types";

export class SimpleProgressReporter implements ProgressReporter {
  public start(name: string, _total: number) {
    sdkConsole.log(`Running evaluator ${name}`);
  }
  public stop() {}
  public increment(_name: string) {}
  public setTotal(_name: string, _total: number) {}
}
