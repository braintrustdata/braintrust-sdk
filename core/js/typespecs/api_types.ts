// Type definitions for operating on the api database.

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

import {
  experimentSchema,
  datasetSchema,
  projectSchema,
  promptSchema,
  functionSchema,
} from "./app_types";
import { functionIdSchema } from "./functions";
import {
  EventObjectType,
  ObjectType,
  ObjectTypeWithEvent,
  datetimeStringSchema,
  getObjectArticle,
  getEventObjectType,
  getEventObjectDescription,
} from "./common_types";
import { customTypes } from "./custom_types";
import { capitalize } from "../src/string_util";
import {
  TRANSACTION_ID_FIELD,
  OBJECT_DELETE_FIELD,
  IS_MERGE_FIELD,
  MERGE_PATHS_FIELD,
  PARENT_ID_FIELD,
  VALID_SOURCES,
} from "../src/db_fields";
import { spanTypeAttributeValues } from "../src/span_types";
import { objectNullish } from "../src/zod_util";

const auditSourcesSchema = z.enum(VALID_SOURCES);

function generateBaseEventOpSchema(objectType: ObjectTypeWithEvent) {
  const eventDescription = getEventObjectDescription(objectType);
  return z.object({
    id: z
      .string()
      .describe(
        `A unique identifier for the ${eventDescription} event. If you don't provide one, BrainTrust will generate one for you`,
      ),
    [TRANSACTION_ID_FIELD]: z
      .string()
      .describe(
        `The transaction id of an event is unique to the network operation that processed the event insertion. Transaction ids are monotonically increasing over time and can be used to retrieve a versioned snapshot of the ${eventDescription} (see the \`version\` parameter)`,
      ),
    created: datetimeStringSchema.describe(
      `The timestamp the ${eventDescription} event was created`,
    ),
    input: customTypes.unknown,
    output: customTypes.unknown,
    expected: customTypes.unknown,
    error: customTypes.unknown.describe("The error that occurred, if any."),
    tags: z.array(z.string()).nullish().describe("A list of tags to log"),
    scores: z.record(z.number().min(0).max(1).nullish()).nullish(),
    metadata: z
      .record(customTypes.unknown)
      .nullish()
      .describe(
        "A dictionary with additional data about the test example, model outputs, or just about anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any JSON-serializable type, but its keys must be strings",
      ),
    metrics: z
      .object({
        start: z
          .number()
          .nullish()
          .describe(
            `A unix timestamp recording when the section of code which produced the ${eventDescription} event started`,
          ),
        end: z
          .number()
          .nullish()
          .describe(
            `A unix timestamp recording when the section of code which produced the ${eventDescription} event finished`,
          ),
        prompt_tokens: z
          .number()
          .int()
          .nullish()
          .describe(
            `The number of tokens in the prompt used to generate the ${eventDescription} event (only set if this is an LLM span)`,
          ),
        completion_tokens: z
          .number()
          .int()
          .nullish()
          .describe(
            `The number of tokens in the completion generated by the model (only set if this is an LLM span)`,
          ),
        tokens: z
          .number()
          .int()
          .nullish()
          .describe(
            `The total number of tokens in the input and output of the ${eventDescription} event.`,
          ),
      })
      // We are permissive of non-numerical metrics here because not all
      // versions of the SDK have validated that metrics are entirely numerical.
      // There are also old logged metrics which contain the `caller_*`
      // information. We could potentially stricten this by adding some
      // backfills to the chalice backend.
      .catchall(customTypes.unknown)
      .nullish()
      .describe(
        `Metrics are numerical measurements tracking the execution of the code that produced the ${eventDescription} event. Use "start" and "end" to track the time span over which the ${eventDescription} event was produced`,
      ),
    context: z
      .object({
        caller_functionname: z
          .string()
          .nullish()
          .describe(
            `The function in code which created the ${eventDescription} event`,
          ),
        caller_filename: z
          .string()
          .nullish()
          .describe(
            `Name of the file in code where the ${eventDescription} event was created`,
          ),
        caller_lineno: z
          .number()
          .int()
          .nullish()
          .describe(
            `Line of code where the ${eventDescription} event was created`,
          ),
      })
      .catchall(customTypes.unknown)
      .nullish()
      .describe(
        `Context is additional information about the code that produced the ${eventDescription} event. It is essentially the textual counterpart to \`metrics\`. Use the \`caller_*\` attributes to track the location in code which produced the ${eventDescription} event`,
      ),
    span_id: z
      .string()
      .describe(
        `A unique identifier used to link different ${eventDescription} events together as part of a full trace. See the [tracing guide](https://www.braintrust.dev/docs/guides/tracing) for full details on tracing`,
      ),
    span_parents: z
      .string()
      .array()
      .nullish()
      .describe(
        `An array of the parent \`span_ids\` of this ${eventDescription} event. This should be empty for the root span of a trace, and should most often contain just one parent element for subspans`,
      ),
    root_span_id: z
      .string()
      .describe(
        `The \`span_id\` of the root of the trace this ${eventDescription} event belongs to`,
      ),
    span_attributes: z
      .object({
        name: z
          .string()
          .nullish()
          .describe("Name of the span, for display purposes only"),
        type: z
          .enum(spanTypeAttributeValues)
          .nullish()
          .describe("Type of the span, for display purposes only"),
      })
      .catchall(customTypes.unknown)
      .nullish()
      .describe(
        "Human-identifying attributes of the span, such as name, type, etc.",
      ),
    origin: z
      .object({
        object_type: z.string(),
        object_id: z.string().uuid(),
        id: z.string(),
      })
      .optional(),
    [OBJECT_DELETE_FIELD]: z
      .boolean()
      .nullish()
      .describe(
        `Pass \`${OBJECT_DELETE_FIELD}=true\` to mark the ${eventDescription} event deleted. Deleted events will not show up in subsequent fetches for this ${eventDescription}`,
      ),
  });
}

function generateBaseEventFeedbackSchema(objectType: ObjectTypeWithEvent) {
  const eventObjectType = getEventObjectType(objectType);
  const eventDescription = getEventObjectDescription(objectType);
  return z.object({
    id: z
      .string()
      .describe(
        `The id of the ${eventDescription} event to log feedback for. This is the row \`id\` returned by \`POST /v1/${eventObjectType}/{${objectType}_id}/insert\``,
      ),
    scores: z
      .record(z.number().min(0).max(1).nullish())
      .nullish()
      .describe(
        `A dictionary of numeric values (between 0 and 1) to log. These scores will be merged into the existing scores for the ${eventDescription} event`,
      ),
    expected: customTypes.unknown.describe(
      "The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not",
    ),
    tags: z.array(z.string()).nullish().describe("A list of tags to log"),
    comment: z
      .string()
      .nullish()
      .describe(
        `An optional comment string to log about the ${eventDescription} event`,
      ),
    metadata: z
      .record(customTypes.unknown)
      .nullish()
      .describe(
        "A dictionary with additional data about the feedback. If you have a `user_id`, you can log it here and access it in the Braintrust UI.",
      ),
    source: auditSourcesSchema
      .nullish()
      .describe(
        'The source of the feedback. Must be one of "external" (default), "app", or "api"',
      ),
  });
}

// Section: fetching data objects.

// Pagination for fetching events within data objects.

export const fetchLimitParamSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .describe(
    [
      "limit the number of traces fetched",
      `Fetch queries may be paginated if the total result size is expected to be large (e.g. project_logs which accumulate over a long time). Note that fetch queries only support pagination in descending time order (from latest to earliest \`${TRANSACTION_ID_FIELD}\`. Furthermore, later pages may return rows which showed up in earlier pages, except with an earlier \`${TRANSACTION_ID_FIELD}\`. This happens because pagination occurs over the whole version history of the event log. You will most likely want to exclude any such duplicate, outdated rows (by \`id\`) from your combined result set.`,
      `The \`limit\` parameter controls the number of full traces to return. So you may end up with more individual rows than the specified limit if you are fetching events containing traces.`,
    ].join("\n\n"),
  )
  .openapi("FetchLimit");

const fetchPaginationCursorDescription = [
  "DEPRECATION NOTICE: The manually-constructed pagination cursor is deprecated in favor of the explicit 'cursor' returned by object fetch requests. Please prefer the 'cursor' argument going forwards.",
  "Together, `max_xact_id` and `max_root_span_id` form a pagination cursor",
  `Since a paginated fetch query returns results in order from latest to earliest, the cursor for the next page can be found as the row with the minimum (earliest) value of the tuple \`(${TRANSACTION_ID_FIELD}, root_span_id)\`. See the documentation of \`limit\` for an overview of paginating fetch queries.`,
].join("\n\n");

export const maxXactIdSchema = z
  .string()
  .describe(fetchPaginationCursorDescription)
  .openapi("MaxXactId");

export const maxRootSpanIdSchema = z
  .string()
  .describe(fetchPaginationCursorDescription)
  .openapi("MaxRootSpanId");

export const fetchPaginationCursorSchema = z
  .string()
  .describe(
    [
      "An opaque string to be used as a cursor for the next page of results, in order from latest to earliest.",
      "The string can be obtained directly from the `cursor` property of the previous fetch query",
    ].join("\n\n"),
  )
  .openapi("FetchPaginationCursor");

export const versionSchema = z
  .string()
  .describe(
    [
      "Retrieve a snapshot of events from a past time",
      "The version id is essentially a filter on the latest event transaction id. You can use the `max_xact_id` returned by a past fetch as the version to reproduce that exact fetch.",
    ].join("\n\n"),
  )
  .openapi("Version");

const pathTypeFilterSchema = z
  .object({
    type: z
      .literal("path_lookup")
      .describe("Denotes the type of filter as a path-lookup filter"),
    path: z
      .string()
      .array()
      .describe(
        'List of fields describing the path to the value to be checked against. For instance, if you wish to filter on the value of `c` in `{"input": {"a": {"b": {"c": "hello"}}}}`, pass `path=["input", "a", "b", "c"]`',
      ),
    value: customTypes.unknown.describe(
      'The value to compare equality-wise against the event value at the specified `path`. The value must be a "primitive", that is, any JSON-serializable object except for objects and arrays. For instance, if you wish to filter on the value of "input.a.b.c" in the object `{"input": {"a": {"b": {"c": "hello"}}}}`, pass `value="hello"`',
    ),
  })
  .describe(
    'A path-lookup filter describes an equality comparison against a specific sub-field in the event row. For instance, if you wish to filter on the value of `c` in `{"input": {"a": {"b": {"c": "hello"}}}}`, pass `path=["input", "a", "b", "c"]` and `value="hello"`',
  )
  .openapi("PathLookupFilter");

export const fetchEventsFiltersSchema = pathTypeFilterSchema
  .array()
  .describe(
    [
      "NOTE: This parameter is deprecated and will be removed in a future revision. Consider using the `/btql` endpoint (https://www.braintrust.dev/docs/reference/btql) for more advanced filtering.",
      "A list of filters on the events to fetch. Currently, only path-lookup type filters are supported.",
    ].join("\n\n"),
  )
  .openapi("FetchEventsFilters");

export const fetchEventsRequestSchema = z
  .object({
    limit: fetchLimitParamSchema.nullish(),
    cursor: fetchPaginationCursorSchema.nullish(),
    max_xact_id: maxXactIdSchema.nullish(),
    max_root_span_id: maxRootSpanIdSchema.nullish(),
    filters: fetchEventsFiltersSchema.nullish(),
    version: versionSchema.nullish(),
  })
  .openapi("FetchEventsRequest");

function makeFetchEventsResponseSchema<T extends z.AnyZodObject>(
  objectType: ObjectTypeWithEvent,
  eventSchema: T,
) {
  const eventName = capitalize(getEventObjectType(objectType), "_").replace(
    "_",
    "",
  );
  return z
    .object({
      events: eventSchema.array().describe("A list of fetched events"),
      cursor: z
        .string()
        .nullish()
        .describe(
          [
            "Pagination cursor",
            "Pass this string directly as the `cursor` param to your next fetch request to get the next page of results. Not provided if the returned result set is empty.",
          ].join("\n\n"),
        ),
    })
    .openapi(`Fetch${eventName}EventsResponse`);
}

const experimentEventBaseSchema = generateBaseEventOpSchema("experiment");
export const experimentEventSchema = z
  .object({
    id: experimentEventBaseSchema.shape.id,
    dataset_record_id: z
      .string()
      .nullish()
      .describe(
        "If the experiment is associated to a dataset, this is the event-level dataset id this experiment event is tied to",
      ),
    [TRANSACTION_ID_FIELD]:
      experimentEventBaseSchema.shape[TRANSACTION_ID_FIELD],
    created: experimentEventBaseSchema.shape.created,
    project_id: experimentSchema.shape.project_id,
    experiment_id: experimentSchema.shape.id,
    input: experimentEventBaseSchema.shape.input.describe(
      "The arguments that uniquely define a test case (an arbitrary, JSON serializable object). Later on, Braintrust will use the `input` to know whether two test cases are the same between experiments, so they should not contain experiment-specific state. A simple rule of thumb is that if you run the same experiment twice, the `input` should be identical",
    ),
    output: experimentEventBaseSchema.shape.output.describe(
      "The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question",
    ),
    expected: experimentEventBaseSchema.shape.expected.describe(
      "The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate your experiments while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models",
    ),
    error: experimentEventBaseSchema.shape.error,
    scores: experimentEventBaseSchema.shape.scores.describe(
      "A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare experiments",
    ),
    metadata: experimentEventBaseSchema.shape.metadata,
    tags: experimentEventBaseSchema.shape.tags,
    metrics: experimentEventBaseSchema.shape.metrics,
    context: experimentEventBaseSchema.shape.context,
    span_id: experimentEventBaseSchema.shape.span_id,
    span_parents: experimentEventBaseSchema.shape.span_parents,
    root_span_id: experimentEventBaseSchema.shape.root_span_id,
    span_attributes: experimentEventBaseSchema.shape.span_attributes,
  })
  .openapi("ExperimentEvent");
export type ExperimentEvent = z.infer<typeof experimentEventSchema>;

const datasetEventBaseSchema = generateBaseEventOpSchema("dataset");
export const datasetEventSchema = z
  .object({
    id: datasetEventBaseSchema.shape.id,
    [TRANSACTION_ID_FIELD]: datasetEventBaseSchema.shape[TRANSACTION_ID_FIELD],
    created: datasetEventBaseSchema.shape.created,
    project_id: datasetSchema.shape.project_id,
    dataset_id: datasetSchema.shape.id,
    input: datasetEventBaseSchema.shape.input.describe(
      "The argument that uniquely define an input case (an arbitrary, JSON serializable object)",
    ),
    expected: datasetEventBaseSchema.shape.expected.describe(
      "The output of your application, including post-processing (an arbitrary, JSON serializable object)",
    ),
    metadata: datasetEventBaseSchema.shape.metadata,
    tags: datasetEventBaseSchema.shape.tags,
    span_id: datasetEventBaseSchema.shape.span_id,
    root_span_id: datasetEventBaseSchema.shape.root_span_id,
    origin: datasetEventBaseSchema.shape.origin,
  })
  .openapi("DatasetEvent");
export type DatasetEvent = z.infer<typeof datasetEventSchema>;

const promptSessionEventBaseSchema =
  generateBaseEventOpSchema("prompt_session");
export const promptSessionEventSchema = z
  .object({
    id: promptSessionEventBaseSchema.shape.id,
    [TRANSACTION_ID_FIELD]:
      promptSessionEventBaseSchema.shape[TRANSACTION_ID_FIELD],
    created: promptSessionEventBaseSchema.shape.created,
    project_id: promptSchema.shape.project_id,
    prompt_session_id: promptSchema.shape.id,
    prompt_session_data: customTypes.unknown.describe(
      "Data about the prompt session",
    ),
    prompt_data: customTypes.unknown.describe("Data about the prompt"),
    object_data: customTypes.unknown.describe("Data about the mapped data"),
    completion: customTypes.unknown.describe("Data about the completion"),
    tags: promptSessionEventBaseSchema.shape.tags,
  })
  .openapi("PromptSessionEvent");
export type PromptSessionEvent = z.infer<typeof promptSessionEventSchema>;

const projectLogsEventBaseSchema = generateBaseEventOpSchema("project");
export const projectLogsLogIdLiteralSchema = z
  .literal("g")
  .describe("A literal 'g' which identifies the log as a project log");
export const projectLogsEventSchema = z
  .object({
    id: projectLogsEventBaseSchema.shape.id,
    [TRANSACTION_ID_FIELD]:
      projectLogsEventBaseSchema.shape[TRANSACTION_ID_FIELD],
    created: projectLogsEventBaseSchema.shape.created,
    org_id: projectSchema.shape.org_id,
    project_id: projectSchema.shape.id,
    log_id: projectLogsLogIdLiteralSchema,
    input: projectLogsEventBaseSchema.shape.input.describe(
      "The arguments that uniquely define a user input (an arbitrary, JSON serializable object).",
    ),
    output: projectLogsEventBaseSchema.shape.output.describe(
      "The output of your application, including post-processing (an arbitrary, JSON serializable object), that allows you to determine whether the result is correct or not. For example, in an app that generates SQL queries, the `output` should be the _result_ of the SQL query generated by the model, not the query itself, because there may be multiple valid queries that answer a single question.",
    ),
    expected: projectLogsEventBaseSchema.shape.expected.describe(
      "The ground truth value (an arbitrary, JSON serializable object) that you'd compare to `output` to determine if your `output` value is correct or not. Braintrust currently does not compare `output` to `expected` for you, since there are so many different ways to do that correctly. Instead, these values are just used to help you navigate while digging into analyses. However, we may later use these values to re-score outputs or fine-tune your models.",
    ),
    error: projectLogsEventBaseSchema.shape.error,
    scores: projectLogsEventBaseSchema.shape.scores.describe(
      "A dictionary of numeric values (between 0 and 1) to log. The scores should give you a variety of signals that help you determine how accurate the outputs are compared to what you expect and diagnose failures. For example, a summarization app might have one score that tells you how accurate the summary is, and another that measures the word similarity between the generated and grouth truth summary. The word similarity score could help you determine whether the summarization was covering similar concepts or not. You can use these scores to help you sort, filter, and compare logs.",
    ),
    metadata: projectLogsEventBaseSchema.shape.metadata,
    tags: projectLogsEventBaseSchema.shape.tags,
    metrics: projectLogsEventBaseSchema.shape.metrics,
    context: projectLogsEventBaseSchema.shape.context,
    span_id: projectLogsEventBaseSchema.shape.span_id,
    span_parents: projectLogsEventBaseSchema.shape.span_parents,
    root_span_id: projectLogsEventBaseSchema.shape.root_span_id,
    span_attributes: projectLogsEventBaseSchema.shape.span_attributes,
    origin: projectLogsEventBaseSchema.shape.origin,
  })
  .openapi("ProjectLogsEvent");
export type ProjectLogsEvent = z.infer<typeof projectLogsEventSchema>;

// Section: inserting data objects.

// Merge system control fields.

const isMergeDescription = [
  "The `_is_merge` field controls how the row is merged with any existing row with the same id in the DB. By default (or when set to `false`), the existing row is completely replaced by the new row. When set to `true`, the new row is deep-merged into the existing row",
  'For example, say there is an existing row in the DB `{"id": "foo", "input": {"a": 5, "b": 10}}`. If we merge a new row as `{"_is_merge": true, "id": "foo", "input": {"b": 11, "c": 20}}`, the new row will be `{"id": "foo", "input": {"a": 5, "b": 11, "c": 20}}`. If we replace the new row as `{"id": "foo", "input": {"b": 11, "c": 20}}`, the new row will be `{"id": "foo", "input": {"b": 11, "c": 20}}`',
].join("\n\n");

const mergeEventSchema = z.object({
  [IS_MERGE_FIELD]: customTypes.literalTrue.describe(isMergeDescription),
  [MERGE_PATHS_FIELD]: z
    .string()
    .array()
    .array()
    .nullish()
    .describe(
      [
        "The `_merge_paths` field allows controlling the depth of the merge. It can only be specified alongside `_is_merge=true`. `_merge_paths` is a list of paths, where each path is a list of field names. The deep merge will not descend below any of the specified merge paths.",
        'For example, say there is an existing row in the DB `{"id": "foo", "input": {"a": {"b": 10}, "c": {"d": 20}}, "output": {"a": 20}}`. If we merge a new row as `{"_is_merge": true, "_merge_paths": [["input", "a"], ["output"]], "input": {"a": {"q": 30}, "c": {"e": 30}, "bar": "baz"}, "output": {"d": 40}}`, the new row will be `{"id": "foo": "input": {"a": {"q": 30}, "c": {"d": 20, "e": 30}, "bar": "baz"}, "output": {"d": 40}}`. In this case, due to the merge paths, we have replaced `input.a` and `output`, but have still deep-merged `input` and `input.c`.',
      ].join("\n\n"),
    ),
});

const replacementEventSchema = z.object({
  [IS_MERGE_FIELD]: customTypes.literalFalse
    .nullish()
    .describe(isMergeDescription),
  [PARENT_ID_FIELD]: z
    .string()
    .nullish()
    .describe(
      [
        "Use the `_parent_id` field to create this row as a subspan of an existing row. It cannot be specified alongside `_is_merge=true`. Tracking hierarchical relationships are important for tracing (see the [guide](https://www.braintrust.dev/docs/guides/tracing) for full details).",
        'For example, say we have logged a row `{"id": "abc", "input": "foo", "output": "bar", "expected": "boo", "scores": {"correctness": 0.33}}`. We can create a sub-span of the parent row by logging `{"_parent_id": "abc", "id": "llm_call", "input": {"prompt": "What comes after foo?"}, "output": "bar", "metrics": {"tokens": 1}}`. In the webapp, only the root span row `"abc"` will show up in the summary view. You can view the full trace hierarchy (in this case, the `"llm_call"` row) by clicking on the "abc" row.',
      ].join("\n\n"),
    ),
});

function makeInsertEventSchemas<T extends z.AnyZodObject>(
  objectType: ObjectTypeWithEvent,
  insertSchema: T,
) {
  const eventDescription = getEventObjectDescription(objectType);
  const article = getObjectArticle(objectType);
  const eventSchemaName = capitalize(
    getEventObjectType(objectType),
    "_",
  ).replace("_", "");
  const replaceVariantSchema = insertSchema
    .merge(replacementEventSchema)
    .openapi(`Insert${eventSchemaName}EventReplace`);
  const mergeVariantSchema = insertSchema
    .merge(mergeEventSchema)
    .openapi(`Insert${eventSchemaName}EventMerge`);
  const eventSchema = z
    .union([replaceVariantSchema, mergeVariantSchema])
    .describe(`${capitalize(article)} ${eventDescription} event`)
    .openapi(`Insert${eventSchemaName}Event`);
  const requestSchema = z
    .object({
      events: eventSchema
        .array()
        .describe(`A list of ${eventDescription} events to insert`),
    })
    .openapi(`Insert${eventSchemaName}EventRequest`);
  return { eventSchema, requestSchema };
}

export const insertEventsResponseSchema = z
  .object({
    row_ids: z
      .string()
      .array()
      .describe(
        "The ids of all rows that were inserted, aligning one-to-one with the rows provided as input",
      ),
  })
  .openapi("InsertEventsResponse");

export const feedbackResponseSchema = z
  .object({
    status: z.literal("success"),
  })
  .openapi("FeedbackResponseSchema");

const insertExperimentEventBaseSchema = objectNullish(
  experimentEventSchema
    .pick({
      input: true,
      output: true,
      expected: true,
      error: true,
      scores: true,
      metadata: true,
      tags: true,
      metrics: true,
      context: true,
      span_attributes: true,
      id: true,
      dataset_record_id: true,
      created: true,
    })
    .extend({
      [OBJECT_DELETE_FIELD]:
        experimentEventBaseSchema.shape[OBJECT_DELETE_FIELD],
    }),
);
const {
  eventSchema: insertExperimentEventSchema,
  requestSchema: insertExperimentEventsRequestSchema,
} = makeInsertEventSchemas("experiment", insertExperimentEventBaseSchema);

const insertDatasetEventBaseSchema = objectNullish(
  datasetEventSchema
    .pick({
      input: true,
      expected: true,
      metadata: true,
      tags: true,
      id: true,
      created: true,
    })
    .extend({
      [OBJECT_DELETE_FIELD]: datasetEventBaseSchema.shape[OBJECT_DELETE_FIELD],
    }),
);
const {
  eventSchema: insertDatasetEventSchema,
  requestSchema: insertDatasetEventsRequestSchema,
} = makeInsertEventSchemas("dataset", insertDatasetEventBaseSchema);

const insertProjectLogsEventBaseSchema = objectNullish(
  projectLogsEventSchema
    .pick({
      input: true,
      output: true,
      expected: true,
      error: true,
      scores: true,
      metadata: true,
      tags: true,
      metrics: true,
      context: true,
      span_attributes: true,
      id: true,
      created: true,
    })
    .extend({
      [OBJECT_DELETE_FIELD]:
        projectLogsEventBaseSchema.shape[OBJECT_DELETE_FIELD],
    }),
);
const {
  eventSchema: insertProjectLogsEventSchema,
  requestSchema: insertProjectLogsEventsRequestSchema,
} = makeInsertEventSchemas("project", insertProjectLogsEventBaseSchema);

// Section: logging feedback.

function makeFeedbackRequestSchema<T extends z.AnyZodObject>(
  objectType: ObjectTypeWithEvent,
  feedbackSchema: T,
) {
  const eventDescription = getEventObjectDescription(objectType);
  const eventSchemaName = capitalize(
    getEventObjectType(objectType),
    "_",
  ).replace("_", "");
  return z
    .object({
      feedback: feedbackSchema
        .array()
        .describe(`A list of ${eventDescription} feedback items`),
    })
    .openapi(`Feedback${eventSchemaName}EventRequest`);
}

const feedbackExperimentRequestBaseSchema =
  generateBaseEventFeedbackSchema("experiment");
const feedbackExperimentItemSchema = feedbackExperimentRequestBaseSchema
  .pick({
    id: true,
    scores: true,
    expected: true,
    comment: true,
    metadata: true,
    source: true,
  })
  .openapi("FeedbackExperimentItem");
const feedbackExperimentRequestSchema = makeFeedbackRequestSchema(
  "experiment",
  feedbackExperimentItemSchema,
);

const feedbackDatasetRequestBaseSchema =
  generateBaseEventFeedbackSchema("dataset");
const feedbackDatasetItemSchema = feedbackDatasetRequestBaseSchema
  .pick({
    id: true,
    comment: true,
    metadata: true,
    source: true,
  })
  .openapi("FeedbackDatasetItem");
const feedbackDatasetRequestSchema = makeFeedbackRequestSchema(
  "dataset",
  feedbackDatasetItemSchema,
);

const feedbackProjectLogsRequestBaseSchema =
  generateBaseEventFeedbackSchema("project");
const feedbackProjectLogsItemSchema = feedbackProjectLogsRequestBaseSchema
  .pick({
    id: true,
    scores: true,
    expected: true,
    comment: true,
    metadata: true,
    source: true,
  })
  .openapi("FeedbackProjectLogsItem");
const feedbackProjectLogsRequestSchema = makeFeedbackRequestSchema(
  "project",
  feedbackProjectLogsItemSchema,
);

// Section: exported schemas, grouped by object type. The schemas are used for
// API spec generation, so their types are not fully-specified. If you wish to
// use individual schema types, import them directly.

export type EventObjectSchemasEntry = {
  event?: Zod.ZodTypeAny;
  fetchResponse?: Zod.ZodTypeAny;
  insertEvent?: Zod.ZodTypeAny;
  insertRequest?: Zod.ZodTypeAny;
  feedbackItem?: Zod.ZodTypeAny;
  feedbackRequest?: Zod.ZodTypeAny;
};

export const apiSpecEventObjectSchemas: Record<
  EventObjectType,
  EventObjectSchemasEntry
> = {
  experiment: {
    event: experimentEventSchema,
    fetchResponse: makeFetchEventsResponseSchema(
      "experiment",
      experimentEventSchema,
    ),
    insertEvent: insertExperimentEventSchema,
    insertRequest: insertExperimentEventsRequestSchema,
    feedbackItem: feedbackExperimentItemSchema,
    feedbackRequest: feedbackExperimentRequestSchema,
  },
  dataset: {
    event: datasetEventSchema,
    fetchResponse: makeFetchEventsResponseSchema("dataset", datasetEventSchema),
    insertEvent: insertDatasetEventSchema,
    insertRequest: insertDatasetEventsRequestSchema,
    feedbackItem: feedbackDatasetItemSchema,
    feedbackRequest: feedbackDatasetRequestSchema,
  },
  project_logs: {
    event: projectLogsEventSchema,
    fetchResponse: makeFetchEventsResponseSchema(
      "project",
      projectLogsEventSchema,
    ),
    insertEvent: insertProjectLogsEventSchema,
    insertRequest: insertProjectLogsEventsRequestSchema,
    feedbackItem: feedbackProjectLogsItemSchema,
    feedbackRequest: feedbackProjectLogsRequestSchema,
  },
  prompt: {
    event: promptSchema,
  },
  function: {
    event: functionSchema,
  },
  prompt_session: {},
};

// Section: Cross-object operation schemas.

function makeCrossObjectIndividualRequestSchema(
  objectType: ObjectTypeWithEvent,
) {
  const eventObjectType = getEventObjectType(objectType);
  const eventDescription = getEventObjectDescription(objectType);
  const eventObjectSchema = apiSpecEventObjectSchemas[eventObjectType];
  const insertObject = z.object({
    ...(eventObjectSchema.insertEvent
      ? {
          events: eventObjectSchema.insertEvent
            .array()
            .nullish()
            .describe(`A list of ${eventDescription} events to insert`),
        }
      : {}),
    ...(eventObjectSchema.feedbackItem
      ? {
          feedback: eventObjectSchema.feedbackItem
            .array()
            .nullish()
            .describe(`A list of ${eventDescription} feedback items`),
        }
      : {}),
  });
  return z
    .record(z.string().uuid(), insertObject)
    .nullish()
    .describe(
      `A mapping from ${objectType} id to a set of log events and feedback items to insert`,
    );
}

function makeCrossObjectIndividualResponseSchema(objectType: ObjectType) {
  return z
    .record(z.string().uuid(), insertEventsResponseSchema)
    .nullish()
    .describe(
      `A mapping from ${objectType} id to row ids for inserted \`events\``,
    );
}

export const crossObjectInsertRequestSchema = z
  .object({
    experiment: makeCrossObjectIndividualRequestSchema("experiment"),
    dataset: makeCrossObjectIndividualRequestSchema("dataset"),
    project_logs: makeCrossObjectIndividualRequestSchema("project"),
  })
  .openapi("CrossObjectInsertRequest");

export const crossObjectInsertResponseSchema = z
  .object({
    experiment: makeCrossObjectIndividualResponseSchema("experiment"),
    dataset: makeCrossObjectIndividualResponseSchema("dataset"),
    project_logs: makeCrossObjectIndividualResponseSchema("project"),
  })
  .openapi("CrossObjectInsertResponse");

// Section: Summarization operations.

export const summarizeScoresParamSchema = z.coerce
  .boolean()
  .describe(
    "Whether to summarize the scores and metrics. If false (or omitted), only the metadata will be returned.",
  );

export const comparisonExperimentIdParamSchema = z
  .string()
  .uuid()
  .describe(
    "The experiment to compare against, if summarizing scores and metrics. If omitted, will fall back to the `base_exp_id` stored in the experiment metadata, and then to the most recent experiment run in the same project. Must pass `summarize_scores=true` for this id to be used",
  );

export const summarizeDataParamSchema = z.coerce
  .boolean()
  .describe(
    "Whether to summarize the data. If false (or omitted), only the metadata will be returned.",
  );

const summarizeExperimentResponseSchema = z
  .object({
    project_name: z
      .string()
      .describe("Name of the project that the experiment belongs to"),
    experiment_name: z.string().describe("Name of the experiment"),
    project_url: z
      .string()
      .url()
      .describe("URL to the project's page in the Braintrust app"),
    experiment_url: z
      .string()
      .url()
      .describe("URL to the experiment's page in the Braintrust app"),
    comparison_experiment_name: z
      .string()
      .nullish()
      .describe("The experiment which scores are baselined against"),
    scores: z
      .record(
        z
          .object({
            name: z.string().describe("Name of the score"),
            score: z
              .number()
              .min(0)
              .max(1)
              .describe("Average score across all examples"),
            diff: z
              .number()
              .min(-1)
              .max(1)
              .optional()
              .describe(
                "Difference in score between the current and comparison experiment",
              ),
            improvements: z
              .number()
              .int()
              .min(0)
              .describe("Number of improvements in the score"),
            regressions: z
              .number()
              .int()
              .min(0)
              .describe("Number of regressions in the score"),
          })
          .describe("Summary of a score's performance")
          .openapi("ScoreSummary"),
      )
      .nullish()
      .describe("Summary of the experiment's scores"),
    metrics: z
      .record(
        z
          .object({
            name: z.string().describe("Name of the metric"),
            metric: z.number().describe("Average metric across all examples"),
            unit: z.string().describe("Unit label for the metric"),
            diff: z
              .number()
              .optional()
              .describe(
                "Difference in metric between the current and comparison experiment",
              ),
            improvements: z
              .number()
              .int()
              .min(0)
              .describe("Number of improvements in the metric"),
            regressions: z
              .number()
              .int()
              .min(0)
              .describe("Number of regressions in the metric"),
          })
          .describe("Summary of a metric's performance")
          .openapi("MetricSummary"),
      )
      .nullish()
      .describe("Summary of the experiment's metrics"),
  })
  .describe("Summary of an experiment")
  .openapi("SummarizeExperimentResponse");

const summarizeDatasetResponseSchema = z
  .object({
    project_name: z
      .string()
      .describe("Name of the project that the dataset belongs to"),
    dataset_name: z.string().describe("Name of the dataset"),
    project_url: z
      .string()
      .url()
      .describe("URL to the project's page in the Braintrust app"),
    dataset_url: z
      .string()
      .url()
      .describe("URL to the dataset's page in the Braintrust app"),
    data_summary: z
      .object({
        total_records: z
          .number()
          .int()
          .min(0)
          .describe("Total number of records in the dataset"),
      })
      .nullish()
      .describe("Summary of a dataset's data")
      .openapi("DataSummary"),
  })
  .describe("Summary of a dataset")
  .openapi("SummarizeDatasetResponse");

export const objectTypeSummarizeResponseSchemas: {
  [K in ObjectType]?: z.ZodTypeAny;
} = {
  experiment: summarizeExperimentResponseSchema,
  dataset: summarizeDatasetResponseSchema,
};

// Section: async scoring.

export const asyncScoringStateSchema = z
  .union([
    z.object({
      status: z.literal("enabled"),
      token: z.string(),
      function_ids: z.array(functionIdSchema).nonempty(),
    }),
    // Explicitly disabled.
    z.object({
      status: z.literal("disabled"),
    }),
    // Inactive but may be selected later.
    z.null(),
  ])
  .openapi("AsyncScoringState");

export type AsyncScoringState = z.infer<typeof asyncScoringStateSchema>;

export const asyncScoringControlSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("score_update"),
      token: z.string(),
    }),
    z.object({
      kind: z.literal("state_override"),
      state: asyncScoringStateSchema,
    }),
    z.object({
      kind: z.literal("state_force_reselect"),
    }),
  ])
  .openapi("AsyncScoringControl");

export type AsyncScoringControl = z.infer<typeof asyncScoringControlSchema>;
