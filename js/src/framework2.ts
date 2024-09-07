import { wrapTraced } from "./logger";

export function initProject(name: string) {
  return new ProjectBuilder(name);
}

type IsPromise<T> = T extends Promise<any> ? true : false;

export interface Task<Input, Output> {
  task: (input: Input) => Output;
  _name: string;
}

export interface ExecutableTask<Input, Output> extends Task<Input, Output> {
  (input: Input): Output;
}

export interface TaskOpts {
  name?: string;
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
      asyncFlush: true, // XXX Manu: shouold we make this a flag?
    });

    const task: ExecutableTask<Input, Output> = Object.assign(wrapped, {
      task: taskFn,
      _name: opts.name ?? taskFn.name,
    });

    if (globalThis._lazy_load) {
      globalThis._evals.tasks[task.name] = task;
    }

    return task;
  }
}
