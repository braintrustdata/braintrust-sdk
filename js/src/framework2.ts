import path from "path";
import { wrapTraced } from "./logger";
import slugifyLib from "slugify";
import { _initializeSpanContext } from "./framework";

export function initProject(name: string) {
  return new ProjectBuilder(name);
}

export interface Task<Input, Output> {
  task: (input: Input) => Output;
  projectName: string;
  taskName: string;
  slug: string;
  description?: string;
}

export interface ExecutableTask<Input, Output> extends Task<Input, Output> {
  (input: Input): Output;
}

export interface TaskOpts {
  name?: string;
  slug?: string;
  description?: string;
}

export class ProjectBuilder {
  private taskCounter = 0;
  constructor(private name: string) {
    _initializeSpanContext();
  }

  public task<Input, Output>(
    taskFn: (input: Input) => Output,
    opts?: TaskOpts,
  ): ExecutableTask<Input, Output> {
    this.taskCounter++;
    opts = opts ?? {};

    let name = opts.name ?? taskFn.name;

    if (name.trim().length === 0) {
      name = `Task ${path.basename(__filename)} ${this.taskCounter}`;
    }

    const wrapped = wrapTraced(taskFn, {
      name,
      asyncFlush: true, // XXX Manu: should we make this a flag?
    });

    const task: ExecutableTask<Input, Output> = Object.assign(wrapped, {
      task: taskFn,
      projectName: this.name,
      taskName: name,
      description: opts.description,
      slug: opts.slug ?? slugifyLib(name, { lower: true, strict: true }),
    });

    if (globalThis._lazy_load) {
      globalThis._evals.tasks.push(task);
    }

    return task;
  }
}
