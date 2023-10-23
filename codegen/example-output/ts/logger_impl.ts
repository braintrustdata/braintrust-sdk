import {
  RegisteredProject,
  DatasetConstructorArgs,
  DatasetInsertArgs,
} from "./types";

class BackgroundLogger {
  public log(args: any): void {}
}

export class DatasetImpl {
  public readonly project: RegisteredProject;
  public readonly id: string;
  public readonly name: string;
  private pinnedVersion?: string;
  private _fetchedData?: any[] = undefined;
  private logger: BackgroundLogger;
  private finished: boolean;

  constructor(args: DatasetConstructorArgs) {
    this.finished = false;

    this.project = args.project;
    this.id = args.id;
    this.name = args.name;
    this.pinnedVersion = args.pinnedVersion;
    this.logger = new BackgroundLogger();
  }

  public insert(args: DatasetInsertArgs): string {
    this.checkNotFinished();

    if (args.metadata !== undefined) {
      for (const key of Object.keys(args.metadata)) {
        if (typeof key !== "string") {
          throw new Error("metadata keys must be strings");
        }
      }
    }

    const logArgs = {
      id: args.id || "noname",
      inputs: args.input,
      output: args.output,
      project_id: this.project.id,
      dataset_id: this.id,
      created: new Date().toISOString(),
      metadata: args.metadata,
    };

    this.logger.log([logArgs]);
    return logArgs.id;
  }

  private checkNotFinished() {
    if (this.finished) {
      throw new Error("Cannot invoke method on finished dataset");
    }
  }
}
