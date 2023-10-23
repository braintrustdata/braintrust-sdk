import {
  RegisteredProject,
  DatasetConstructorArgs,
  DatasetInsertArgs,
} from "./types";
import * as impl from "./logger_impl";

/**
 * A dataset is a collection of records, such as model inputs and outputs, which represent data you can use to evaluate and fine-tune models. You can log production data to datasets, curate them with interesting examples, edit/delete records, and run evaluations against them.
 *
 * You should not create `Dataset` objects directly. Instead, use the `braintrust.initDataset` method
 */
export class Dataset {
  private _impl: impl.DatasetImpl;

  constructor(
    project: RegisteredProject,
    id: string,
    name: string,
    options: { pinnedVersion?: string | undefined }
  ) {
    this._impl = new impl.DatasetImpl({ project, id, name, ...options });
  }

  /**
   * Insert a single record to the dataset. The record will be batched and uploaded behind the scenes. If you pass in an `id`, and a record with that `id` already exists, it will be overwritten (upsert).
   *
   * @param input The argument that uniquely define an input case (an arbitrary, JSON serializable object).
   * @param output The output of your application, including post-processing (an arbitrary, JSON serializable object).
   * @param options
   * @param options.metadata (Optional) a dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings.
   * @param options.id (Optional) a unique identifier for the event. If you don't provide one, Braintrust will generate one for you.
   * @returns The `id` of the logged record.
   */
  insert(
    input: unknown,
    output: unknown,
    options: {
      metadata?: Record<string, unknown> | undefined;
      id?: string | undefined;
    }
  ): string {
    return this._impl.insert({ input, output, ...options });
  }
}
