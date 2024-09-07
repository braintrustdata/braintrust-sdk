export function initProject(name: string) {
  return new ProjectBuilder(name);
}

type IsPromise<T> = T extends Promise<any> ? true : false;

export interface Task<Input, Output> {
  task: (input: Input) => Output;
  name: string;
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

    const task: ExecutableTask<Input, Output> = Object.assign(
      (input: Input) => taskFn(input),
      {
        task: taskFn,
        name: opts.name ?? taskFn.name,
      },
    );

    if (globalThis._lazy_load) {
      globalThis._evals.tasks[task.name] = task;
    }

    return task;
  }
}
