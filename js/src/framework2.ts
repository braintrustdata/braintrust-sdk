import path from "path";
import { wrapTraced } from "./logger";
import slugifyLib from "slugify";
import { _initializeSpanContext } from "./framework";
import { z } from "zod";

export function initProject(name: string) {
  return new ProjectBuilder(name);
}

type TaskFn<Input, Output> =
  | ((input: Input) => Output)
  | ((input: Input) => Promise<Output>);

type Schema<Input, Output> = Partial<{
  parameters: z.ZodSchema<Input>;
  returns: z.ZodSchema<Output>;
}>;

export interface Task<Input, Output, Fn extends TaskFn<Input, Output>>
  extends Schema<Input, Output> {
  task: Fn;
  projectName: string;
  taskName: string;
  slug: string;
  description?: string;
}

export type ExecutableTask<
  Input,
  Output,
  Fn extends TaskFn<Input, Output>,
> = Fn & Task<Input, Output, Fn>;

export type TaskOpts<Params, Returns> = {
  name?: string;
  slug?: string;
  description?: string;
} & Schema<Params, Returns>;

export class ProjectBuilder {
  private taskCounter = 0;
  constructor(private name: string) {
    _initializeSpanContext();
  }

  public task<Input, Output, Fn extends TaskFn<Input, Output>>(
    taskFn: Fn,
    opts?: TaskOpts<Input, Output>,
  ): ExecutableTask<Input, Output, Fn> {
    this.taskCounter++;
    opts = opts ?? {};

    let name = opts.name ?? taskFn.name;

    if (name.trim().length === 0) {
      name = `Task ${path.basename(__filename)} ${this.taskCounter}`;
    }

    const wrapped = wrapTraced(taskFn, {
      name,
      asyncFlush: true, // XXX Manu: should we make this a flag?
    }) as Fn;

    const task: ExecutableTask<Input, Output, Fn> = Object.assign(wrapped, {
      task: taskFn,
      projectName: this.name,
      taskName: name,
      description: opts.description,
      slug: opts.slug ?? slugifyLib(name, { lower: true, strict: true }),
      parameters: opts.parameters,
      returns: opts.returns,
    });

    if (globalThis._lazy_load) {
      globalThis._evals.tasks.push(task);
    }

    return task;
  }
}
