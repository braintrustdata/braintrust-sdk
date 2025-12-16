/**
 * Import verification test suite
 *
 * Based on actual exports from src/exports.ts
 *
 * This suite explicitly checks that major Braintrust exports exist.
 * By importing and verifying these exports, we force bundlers to process
 * the full export graph, preventing tree-shaking false positives where
 * "unused" exports might be removed even though they should be available.
 *
 * Tests are categorized as:
 * - Required: Must exist in ALL builds (browser and node)
 * - Node-only: Only expected in node builds (not browser)
 * - Optional: May not exist depending on build configuration
 */

import type { TestResult } from "../helpers/types";
import { assertType, assertDefined } from "../helpers/assertions";

/**
 * Interface for the Braintrust module based on exports.ts
 */
export interface BraintrustModule {
  // Core logging (REQUIRED)
  initLogger?: unknown;
  Logger?: unknown;
  currentLogger?: unknown;
  currentSpan?: unknown;
  Span?: unknown;
  SpanImpl?: unknown;
  startSpan?: unknown;
  log?: unknown;
  flush?: unknown;

  // Datasets (REQUIRED)
  initDataset?: unknown;
  Dataset?: unknown;

  // Experiments (NODE-ONLY)
  initExperiment?: unknown;
  Experiment?: unknown;
  currentExperiment?: unknown;
  ReadonlyExperiment?: unknown;

  // Prompts (REQUIRED)
  loadPrompt?: unknown;
  Prompt?: unknown;
  getPromptVersions?: unknown;

  // Evaluations (NODE-ONLY)
  Eval?: unknown;
  Evaluator?: unknown;
  BaseExperiment?: unknown;
  runEvaluator?: unknown;

  // Tracing (REQUIRED)
  traced?: unknown;
  traceable?: unknown;
  wrapTraced?: unknown;
  updateSpan?: unknown;
  withCurrent?: unknown;

  // Client wrappers (wrapOpenAI is REQUIRED, others optional)
  wrapOpenAI?: unknown;
  wrapAnthropic?: unknown;
  wrapGoogleGenAI?: unknown;
  wrapAISDK?: unknown;
  wrapMastraAgent?: unknown;
  wrapClaudeAgentSDK?: unknown;

  // Utilities (REQUIRED)
  JSONAttachment?: unknown;
  Attachment?: unknown;
  newId?: unknown;
  permalink?: unknown;

  // Functions (REQUIRED)
  invoke?: unknown;
  initFunction?: unknown;

  // Framework2 - Programmatic prompt/function creation (REQUIRED)
  Project?: unknown;
  projects?: unknown;
  PromptBuilder?: unknown;

  // ID Generation (REQUIRED)
  IDGenerator?: unknown;

  // Testing (REQUIRED)
  _exportsForTestingOnly?: unknown;

  // State management (REQUIRED)
  BraintrustState?: unknown;
  login?: unknown;

  [key: string]: unknown;
}

/**
 * Test required core logging exports
 */
export async function testCoreLoggingExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testCoreLoggingExports";

  try {
    assertDefined(module.initLogger, "initLogger must exist");
    assertType(module.initLogger, "function", "initLogger must be a function");

    assertDefined(module.Logger, "Logger must exist");
    assertType(module.Logger, "function", "Logger must be a function/class");

    assertDefined(module.currentLogger, "currentLogger must exist");
    assertType(
      module.currentLogger,
      "function",
      "currentLogger must be a function",
    );

    assertDefined(module.currentSpan, "currentSpan must exist");
    assertType(
      module.currentSpan,
      "function",
      "currentSpan must be a function",
    );

    assertDefined(module.startSpan, "startSpan must exist");
    assertType(module.startSpan, "function", "startSpan must be a function");

    assertDefined(module.log, "log must exist");
    assertType(module.log, "function", "log must be a function");

    assertDefined(module.flush, "flush must exist");
    assertType(module.flush, "function", "flush must be a function");

    return {
      success: true,
      testName,
      message: "Core logging exports verified (7 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required dataset exports
 */
export async function testDatasetExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testDatasetExports";

  try {
    assertDefined(module.initDataset, "initDataset must exist");
    assertType(
      module.initDataset,
      "function",
      "initDataset must be a function",
    );

    assertDefined(module.Dataset, "Dataset must exist");
    assertType(module.Dataset, "function", "Dataset must be a function/class");

    return {
      success: true,
      testName,
      message: "Dataset exports verified (2 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required prompt exports
 */
export async function testPromptExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testPromptExports";

  try {
    assertDefined(module.loadPrompt, "loadPrompt must exist");
    assertType(module.loadPrompt, "function", "loadPrompt must be a function");

    assertDefined(module.Prompt, "Prompt must exist");
    assertType(module.Prompt, "function", "Prompt must be a function/class");

    assertDefined(module.getPromptVersions, "getPromptVersions must exist");
    assertType(
      module.getPromptVersions,
      "function",
      "getPromptVersions must be a function",
    );

    return {
      success: true,
      testName,
      message: "Prompt exports verified (3 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test experiment exports
 */
export async function testExperimentExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testExperimentExports";

  try {
    assertDefined(module.initExperiment, "initExperiment must exist");
    assertType(
      module.initExperiment,
      "function",
      "initExperiment must be a function",
    );

    assertDefined(module.Experiment, "Experiment must exist");
    assertType(
      module.Experiment,
      "function",
      "Experiment must be a function/class",
    );

    assertDefined(module.currentExperiment, "currentExperiment must exist");
    assertType(
      module.currentExperiment,
      "function",
      "currentExperiment must be a function",
    );

    return {
      success: true,
      testName,
      message: "Experiment exports verified (3 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test evaluation exports
 */
export async function testEvalExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testEvalExports";

  try {
    assertDefined(module.Eval, "Eval must exist");
    assertType(module.Eval, "function", "Eval must be a function");

    assertDefined(module.Evaluator, "Evaluator must exist");
    assertType(module.Evaluator, "function", "Evaluator must be a function");

    assertDefined(module.BaseExperiment, "BaseExperiment must exist");
    assertType(
      module.BaseExperiment,
      "function",
      "BaseExperiment must be a function/class",
    );

    return {
      success: true,
      testName,
      message: "Eval exports verified (3 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required tracing exports
 */
export async function testTracingExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testTracingExports";

  try {
    assertDefined(module.traced, "traced must exist");
    assertType(module.traced, "function", "traced must be a function");

    assertDefined(module.traceable, "traceable must exist");
    assertType(module.traceable, "function", "traceable must be a function");

    assertDefined(module.wrapTraced, "wrapTraced must exist");
    assertType(module.wrapTraced, "function", "wrapTraced must be a function");

    assertDefined(module.updateSpan, "updateSpan must exist");
    assertType(module.updateSpan, "function", "updateSpan must be a function");

    assertDefined(module.withCurrent, "withCurrent must exist");
    assertType(
      module.withCurrent,
      "function",
      "withCurrent must be a function",
    );

    return {
      success: true,
      testName,
      message: "Tracing exports verified (5 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test client wrapper exports
 * wrapOpenAI is required, others are optional
 */
export async function testClientWrapperExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testClientWrapperExports";

  try {
    // wrapOpenAI is required
    assertDefined(module.wrapOpenAI, "wrapOpenAI must exist");
    assertType(module.wrapOpenAI, "function", "wrapOpenAI must be a function");

    // Count optional wrappers that exist
    let optionalCount = 0;
    const optionalWrappers = [
      "wrapAnthropic",
      "wrapGoogleGenAI",
      "wrapAISDK",
      "wrapMastraAgent",
      "wrapClaudeAgentSDK",
    ];

    for (const wrapper of optionalWrappers) {
      if (wrapper in module && module[wrapper]) {
        assertType(
          module[wrapper],
          "function",
          `${wrapper} must be a function`,
        );
        optionalCount++;
      }
    }

    return {
      success: true,
      testName,
      message: `Client wrapper exports verified (1 required + ${optionalCount} optional)`,
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required utility exports
 */
export async function testUtilityExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testUtilityExports";

  try {
    assertDefined(module.JSONAttachment, "JSONAttachment must exist");
    assertType(
      module.JSONAttachment,
      "function",
      "JSONAttachment must be a function/class",
    );

    assertDefined(module.Attachment, "Attachment must exist");
    assertType(
      module.Attachment,
      "function",
      "Attachment must be a function/class",
    );

    assertDefined(module.newId, "newId must exist");
    assertType(module.newId, "function", "newId must be a function");

    assertDefined(module.permalink, "permalink must exist");
    assertType(module.permalink, "function", "permalink must be a function");

    return {
      success: true,
      testName,
      message: "Utility exports verified (4 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required function exports
 */
export async function testFunctionExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testFunctionExports";

  try {
    assertDefined(module.invoke, "invoke must exist");
    assertType(module.invoke, "function", "invoke must be a function");

    assertDefined(module.initFunction, "initFunction must exist");
    assertType(
      module.initFunction,
      "function",
      "initFunction must be a function",
    );

    return {
      success: true,
      testName,
      message: "Function exports verified (2 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test framework2 exports (programmatic prompt/function creation)
 */
export async function testFramework2Exports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testFramework2Exports";

  try {
    assertDefined(module.Project, "Project must exist");
    assertType(module.Project, "function", "Project must be a function/class");

    assertDefined(module.projects, "projects must exist");
    assertType(module.projects, "object", "projects must be an object");

    assertDefined(module.PromptBuilder, "PromptBuilder must exist");
    assertType(
      module.PromptBuilder,
      "function",
      "PromptBuilder must be a function/class",
    );

    return {
      success: true,
      testName,
      message: "Framework2 exports verified (3 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required ID generation exports
 */
export async function testIDGeneratorExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testIDGeneratorExports";

  try {
    assertDefined(module.IDGenerator, "IDGenerator must exist");
    assertType(
      module.IDGenerator,
      "function",
      "IDGenerator must be a function/class",
    );

    return {
      success: true,
      testName,
      message: "ID generator exports verified (1 export)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required testing exports
 */
export async function testTestingExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testTestingExports";

  try {
    assertDefined(
      module._exportsForTestingOnly,
      "_exportsForTestingOnly must exist",
    );
    assertType(
      module._exportsForTestingOnly,
      "object",
      "_exportsForTestingOnly must be an object",
    );

    return {
      success: true,
      testName,
      message: "Testing exports verified (1 export)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test required state management exports
 */
export async function testStateManagementExports(
  module: BraintrustModule,
): Promise<TestResult> {
  const testName = "testStateManagementExports";

  try {
    assertDefined(module.BraintrustState, "BraintrustState must exist");
    assertType(
      module.BraintrustState,
      "function",
      "BraintrustState must be a function/class",
    );

    assertDefined(module.login, "login must exist");
    assertType(module.login, "function", "login must be a function");

    return {
      success: true,
      testName,
      message: "State management exports verified (2 exports)",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Run all import verification tests
 *
 * This forces bundlers to process the full Braintrust export graph,
 * preventing tree-shaking false positives.
 *
 * @param module - The Braintrust module to test
 */
export async function runImportVerificationTests(
  module: BraintrustModule,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // All exports must exist in all builds
  results.push(await testCoreLoggingExports(module));
  results.push(await testDatasetExports(module));
  results.push(await testPromptExports(module));
  results.push(await testTracingExports(module));
  results.push(await testClientWrapperExports(module));
  results.push(await testUtilityExports(module));
  results.push(await testFunctionExports(module));
  results.push(await testFramework2Exports(module));
  results.push(await testIDGeneratorExports(module));
  results.push(await testTestingExports(module));
  results.push(await testStateManagementExports(module));
  results.push(await testExperimentExports(module));
  results.push(await testEvalExports(module));

  return results;
}
