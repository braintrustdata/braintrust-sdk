import { initDataset, initExperiment, initLogger } from "braintrust";

async function collect<T>(records: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const record of records) {
    items.push(record);
  }
  return items;
}

async function main() {
  const testRunId = process.env.BRAINTRUST_E2E_RUN_ID ?? "missing-test-run-id";

  const logger = initLogger({
    projectName: "e2e-logging-datasets",
  });

  logger.log({
    input: {
      record: "project-log-row",
      testRunId,
    },
    metadata: {
      kind: "project-log-row",
      scenario: "logging-and-datasets",
      testRunId,
    },
    output: {
      status: "ok",
    },
    scores: {
      pass: 1,
    },
  });

  const experiment = initExperiment("e2e-logging-datasets", {
    baseExperimentId: "experiment:logging-baseline",
    experiment: "e2e-payload-experiment",
    metadata: {
      scenario: "logging-and-datasets",
    },
    tags: ["payloads"],
  });

  experiment.log({
    expected: {
      result: "pass",
    },
    input: {
      record: "experiment-row",
      testRunId,
    },
    metadata: {
      kind: "experiment-row",
      testRunId,
    },
    output: {
      result: "pass",
    },
    scores: {
      pass: 1,
    },
  });

  const dataset = initDataset({
    dataset: "e2e-sdk-dataset",
    metadata: {
      scenario: "logging-and-datasets",
    },
    project: "e2e-logging-datasets",
  });

  dataset.insert({
    expected: {
      answer: "one",
    },
    id: "record-alpha",
    input: {
      prompt: "first",
      testRunId,
    },
    metadata: {
      stage: "inserted",
      testRunId,
    },
    tags: ["seed"],
  });

  await dataset.flush();
  const initialVersion = await dataset.version({ batchSize: 1 });

  dataset.insert({
    expected: {
      answer: "three",
    },
    id: "record-gamma",
    input: {
      prompt: "delete-me",
      testRunId,
    },
    metadata: {
      stage: "delete-target",
      testRunId,
    },
    tags: ["delete"],
  });
  dataset.update({
    expected: {
      answer: "updated",
    },
    id: "record-alpha",
    metadata: {
      stage: "updated",
      testRunId,
    },
    tags: ["seed", "updated"],
  });
  dataset.insert({
    expected: {
      answer: "two",
    },
    id: "record-beta",
    input: {
      prompt: "second",
      testRunId,
    },
    metadata: {
      stage: "inserted-later",
      testRunId,
    },
    tags: ["added"],
  });
  dataset.delete("record-gamma");

  await dataset.flush();

  const currentVersion = await dataset.version({ batchSize: 1 });
  const currentRecords = await collect(dataset.fetch({ batchSize: 1 }));
  const pinnedDataset = initDataset({
    dataset: "e2e-sdk-dataset",
    project: "e2e-logging-datasets",
    version: initialVersion,
  });
  const pinnedRecords = await collect(pinnedDataset.fetch({ batchSize: 1 }));
  const legacyDataset = initDataset({
    dataset: "e2e-sdk-dataset",
    project: "e2e-logging-datasets",
    useOutput: true,
    version: initialVersion,
  });
  const legacyRecords = await collect(legacyDataset.fetch({ batchSize: 1 }));

  await logger.flush();
  await experiment.flush();

  console.log(
    JSON.stringify({
      currentRecords,
      currentVersion,
      initialVersion,
      legacyRecords,
      pinnedRecords,
    }),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
