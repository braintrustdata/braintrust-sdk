import { wrapTraced } from "./logger";
import slugifyLib from "slugify";

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
  constructor(private name: string) {}

  public task<Input, Output>(
    taskFn: (input: Input) => Output,
    opts?: TaskOpts,
  ): ExecutableTask<Input, Output> {
    opts = opts ?? {};

    const name = opts.name ?? taskFn.name;
    const wrapped = wrapTraced(taskFn, {
      name,
      asyncFlush: true, // XXX Manu: should we make this a flag?
    });

    const task: ExecutableTask<Input, Output> = Object.assign(wrapped, {
      task: taskFn,
      projectName: this.name,
      taskName: name,
      description: opts.description,
      slug: opts.slug ?? slugifyLib(name),
    });

    if (globalThis._lazy_load) {
      globalThis._evals.tasks[task.name] = task;
    }

    return task;
  }
}
