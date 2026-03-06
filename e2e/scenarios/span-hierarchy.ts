import {
  currentSpan,
  getSpanParentObject,
  initExperiment,
  initLogger,
  logError,
  startSpan,
  traceable,
  traced,
  updateSpan,
  withCurrent,
  withParent,
  wrapTraced,
} from "braintrust";

async function main() {
  const testRunId = process.env.BRAINTRUST_E2E_RUN_ID ?? "missing-test-run-id";
  const logger = initLogger({
    projectName: "e2e-span-hierarchy",
  });

  const topLevelSpan = startSpan({
    event: {
      metadata: {
        kind: "top-level-start-span",
        testRunId,
      },
    },
    name: "top-level-start-span",
  });
  topLevelSpan.end();

  const loggerRoot = logger.startSpan({
    event: {
      metadata: {
        kind: "logger-root",
        testRunId,
      },
    },
    name: "logger-root",
  });
  const exportedLoggerRoot = await loggerRoot.export();

  await withCurrent(loggerRoot, async () => {
    currentSpan().log({
      metadata: {
        currentSpanMatchesLoggerRoot:
          currentSpan().spanId === loggerRoot.spanId,
        kind: "with-current",
        testRunId,
      },
    });

    const currentChild = startSpan({
      event: {
        metadata: {
          kind: "current-child",
          testRunId,
        },
      },
      name: "current-child",
    });
    currentChild.end();

    const fanIn = loggerRoot.startSpanWithParents(
      "fan-in-span",
      [loggerRoot.spanId, currentChild.spanId],
      {
        event: {
          metadata: {
            kind: "fan-in",
            testRunId,
          },
        },
        name: "fan-in",
      },
    );
    fanIn.setAttributes({
      spanAttributes: {
        mode: "fan-in",
        testRunId,
      },
      type: "task",
    });
    fanIn.end();
    const fanInWithParentMutation = fanIn as typeof fanIn & {
      setSpanParents: (parents: string[]) => void;
    };
    fanInWithParentMutation.setSpanParents([
      loggerRoot.spanId,
      currentChild.spanId,
      "manual-parent",
    ]);
    await logger.flush();
  });

  loggerRoot.end();

  await withParent(exportedLoggerRoot, async () => {
    const parentObject = getSpanParentObject() as {
      data?: {
        span_id?: string;
      };
    };

    await traced(
      (span) => {
        span.log({
          metadata: {
            kind: "reattached",
            parentSpanIdFromContext: parentObject.data?.span_id ?? null,
            testRunId,
          },
        });
      },
      {
        event: {
          metadata: {
            kind: "reattached",
            testRunId,
          },
        },
        name: "reattached",
      },
    );
  });

  const updatable = logger.startSpan({
    event: {
      metadata: {
        kind: "updatable",
        testRunId,
      },
    },
    name: "updatable",
  });
  const exportedUpdatable = await updatable.export();
  updatable.end();

  await logger.flush();

  updateSpan({
    exported: exportedUpdatable,
    metadata: {
      kind: "updatable",
      patched: true,
      testRunId,
    },
    output: {
      state: "updated",
    },
  });

  try {
    await traced(
      async () => {
        throw new Error("traced boom");
      },
      {
        event: {
          metadata: {
            kind: "traced-error",
            testRunId,
          },
        },
        name: "traced-error",
      },
    );
  } catch {}

  const wrappedError = wrapTraced(
    async function wrappedError() {
      throw new Error("wrapped boom");
    },
    {
      event: {
        metadata: {
          kind: "wrapped-error",
          testRunId,
        },
      },
      name: "wrapped-error",
    },
  );

  try {
    await wrappedError();
  } catch {}

  const traceableError = traceable(
    async function traceableError() {
      throw new Error("traceable boom");
    },
    {
      event: {
        metadata: {
          kind: "traceable-error",
          testRunId,
        },
      },
      name: "traceable-error",
    },
  );

  try {
    await traceableError();
  } catch {}

  const manualError = logger.startSpan({
    event: {
      metadata: {
        kind: "manual-error",
        testRunId,
      },
    },
    name: "manual-error",
  });
  logError(manualError, new Error("manual boom"));
  manualError.end();

  const experiment = initExperiment("e2e-span-hierarchy", {
    baseExperimentId: "experiment:span-hierarchy-baseline",
    experiment: "e2e-span-hierarchy-experiment",
    metadata: {
      scenario: "span-hierarchy",
    },
  });
  const experimentRoot = experiment.startSpan({
    event: {
      metadata: {
        kind: "experiment-root",
        testRunId,
      },
    },
    name: "experiment-root",
  });
  const experimentChild = experimentRoot.startSpan({
    event: {
      metadata: {
        kind: "experiment-child",
        testRunId,
      },
    },
    name: "experiment-child",
  });
  const exportedExperimentChild = await experimentChild.export();
  experimentChild.end();
  experimentRoot.end();

  const explicitParentChild = startSpan({
    event: {
      metadata: {
        kind: "explicit-parent-child",
        testRunId,
      },
    },
    name: "explicit-parent-child",
    parent: exportedExperimentChild,
  });
  explicitParentChild.end();

  await logger.flush();
  await experiment.flush();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
