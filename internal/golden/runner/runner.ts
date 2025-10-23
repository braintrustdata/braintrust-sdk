import { _exportsForTestingOnly, initLogger, Span } from "braintrust";
import { attempt, Result } from "./attempt";
import path from "path";
import { glob } from "glob";
import { isTestExample, saveResult } from "./utils";
import { normalizeTrace, NormalizeResponse } from "./normalize";
import {
  PROJECT_NAME,
  PROJECT_ID,
  OUTPUT_MODES,
  OutputMode,
} from "./constants";

export interface RunOptions {
  glob: string;
  filter?: string;
  output: OutputMode;
}

export interface TestResult {
  file: string;
  example: string;
  raw: Result<Span[]>;
  normalized?: Result<NormalizeResponse>;
  lingua?: Result<NormalizeResponse>;
  diff?: {
    aVsB: string;
  };
}

export interface PrintOutput {
  testFile: string;
  testName: string;
  spans: unknown;
  normalized: unknown;
  lingua: unknown;
}

const runExample = async (
  example: () => Promise<Span>,
): Promise<Result<Span>> => {
  const result = await attempt(example);

  if (!result.success) {
    return result;
  }

  return { success: true, data: result.data };
};

export const run = async (
  options: RunOptions,
): Promise<PrintOutput[] | TestResult[]> => {
  const { output: outputMode } = options;

  // Only show setup messages in files mode
  if (outputMode === OUTPUT_MODES.FILES) {
    console.error("Setting up test environment...");
    console.error(`File glob pattern: ${options.glob}`);
    if (options.filter) {
      console.error(`Test filter regex: ${options.filter}`);
    }
    console.error(`Output mode: ${outputMode}`);
  }

  await _exportsForTestingOnly.simulateLoginForTests();

  const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  // Find all TypeScript test files using glob
  const parentDir = path.join(__dirname, "..");
  const globPattern = path.join(parentDir, options.glob);
  const testFiles = await glob(globPattern, {
    ignore: ["**/node_modules/**", "**/*.d.ts", "**/runner/**", "**/.*.ts"],
  });

  // Convert to relative paths from parent directory
  const relativeTestFiles = testFiles.map((file) =>
    path.relative(parentDir, file),
  );

  if (outputMode === OUTPUT_MODES.FILES) {
    console.error(
      `Found ${relativeTestFiles.length} test files:`,
      relativeTestFiles,
    );
  }

  const testFilter = options.filter ? new RegExp(options.filter) : undefined;

  const logger = initLogger({
    projectName: PROJECT_NAME,
    projectId: PROJECT_ID,
  });

  const results: TestResult[] = [];

  // Collect all results for print mode
  const printOutput: PrintOutput[] = [];

  for (const testFile of relativeTestFiles) {
    if (outputMode === OUTPUT_MODES.FILES) {
      console.error(`\n=== Running tests from ${testFile} ===`);
    }

    const fullPath = path.join(parentDir, testFile);
    const module = await import(fullPath);

    // Call setup if it exists
    if (module?.setup) {
      await module.setup(logger);
    }

    const testExamples: Array<() => Promise<Span>> = Object.entries(module)
      .filter((entry): entry is [string, () => Promise<Span>] =>
        isTestExample(entry[0], entry[1]),
      )
      .map(([_, value]) => value)
      .filter((example) => !testFilter || testFilter.test(example.name || ""));

    if (outputMode === OUTPUT_MODES.FILES) {
      console.error(
        `Found ${testExamples.length} test examples in ${testFile}${
          testFilter ? " (after filtering)" : ""
        }`,
      );
    }

    if (testExamples.length === 0) {
      if (outputMode === OUTPUT_MODES.FILES) {
        console.error(`Skipping ${testFile} - no test examples found`);
      }
      continue;
    }

    for (const example of testExamples) {
      const result = await runExample(example);

      if (outputMode === OUTPUT_MODES.FILES) {
        console.error(`  Running: ${example.name}`);
      }

      if (!result.success) {
        if (outputMode === OUTPUT_MODES.FILES) {
          console.error(
            `    ❌ Test failed:`,
            "error" in result ? result.error : "Unknown error",
          );
        }
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const raw = (await attempt(async () =>
        backgroundLogger.drain(),
      )) as Result<Span[]>;

      if (!raw.success) {
        results.push({
          file: testFile,
          example: example.name,
          raw,
        });
      } else {
        const normalized = await attempt(() =>
          normalizeTrace(raw.data, { useLingua: false }),
        );
        const lingua = await attempt(() =>
          normalizeTrace(raw.data, { useLingua: true }),
        );

        const testResult: TestResult = {
          file: testFile,
          example: example.name,
          raw,
          normalized,
          lingua,
        };

        results.push(testResult);

        const resultData = {
          testFile,
          testName: example.name,
          spans: raw.data,
          normalized: normalized.success ? normalized.data : normalized,
          lingua: lingua.success ? lingua.data : lingua,
        };

        if (outputMode === OUTPUT_MODES.FILES) {
          // Save result to filesystem
          await saveResult(fullPath, example.name, resultData);
        } else {
          // Collect for print mode
          printOutput.push(resultData);
        }
      }
    }
  }

  // In print mode, output all results as JSON and exit
  if (outputMode === OUTPUT_MODES.PRINT) {
    console.log(JSON.stringify(printOutput, null, 2));
    _exportsForTestingOnly.clearTestBackgroundLogger();
    return printOutput;
  }

  // Log summary of results (files mode only)
  logSummary(results, relativeTestFiles);

  _exportsForTestingOnly.clearTestBackgroundLogger();

  return results;
};

function logSummary(results: TestResult[], testFiles: string[]): void {
  console.error("\n=== Normalization Summary ===");
  console.error(`Total test files processed: ${testFiles.length}`);
  console.error(`Total test examples run: ${results.length}`);

  // Group results by file
  const resultsByFile: Record<string, TestResult[]> = {};
  for (const result of results) {
    if (!resultsByFile[result.file]) {
      resultsByFile[result.file] = [];
    }
    resultsByFile[result.file].push(result);
  }

  // Show results per file
  console.error("\n=== Results by File ===");
  for (const [file, fileResults] of Object.entries(resultsByFile)) {
    console.error(`\n${file}:`);
    console.error(`  Total tests: ${fileResults.length}`);

    let fileNormalizedCount = 0;
    let fileLinguaCount = 0;

    for (const result of fileResults) {
      if (result.normalized?.success && result.normalized.data.converters) {
        const convertersUsed = Object.values(result.normalized.data.converters);
        if (convertersUsed.length > 0) {
          fileNormalizedCount++;
        }
      }
      if (result.lingua?.success && result.lingua.data.converters) {
        const convertersUsed = Object.values(result.lingua.data.converters);
        if (convertersUsed.length > 0) {
          fileLinguaCount++;
        }
      }
    }

    console.error(
      `  Normalized (standard): ${fileNormalizedCount}/${fileResults.length}`,
    );
    console.error(
      `  Normalized (lingua): ${fileLinguaCount}/${fileResults.length}`,
    );

    // Show which tests were saved
    const savedTests = fileResults.map((r) => r.example);
    console.error(`  Saved tests: ${savedTests.join(", ")}`);
  }

  // Overall converter usage statistics
  const converterStats: Record<string, number> = {};
  const linguaStats = { successful: 0, failed: 0 };

  for (const result of results) {
    if (result.normalized?.success && result.normalized.data.converters) {
      for (const converter of Object.values(
        result.normalized.data.converters,
      )) {
        converterStats[converter] = (converterStats[converter] || 0) + 1;
      }
    }
    if (result.lingua?.success) {
      const hasConverters =
        Object.keys(result.lingua.data.converters).length > 0;
      if (hasConverters) {
        linguaStats.successful++;
      } else {
        linguaStats.failed++;
      }
    }
  }

  console.error("\n=== Converter Usage ===");
  if (Object.keys(converterStats).length > 0) {
    console.error("Standard converters:");
    for (const [converter, count] of Object.entries(converterStats)) {
      console.error(`  ${converter}: ${count} spans`);
    }
  }
  console.error("\nLingua converter:");
  console.error(`  Successful: ${linguaStats.successful} test cases`);
  console.error(`  Not detected: ${linguaStats.failed} test cases`);
}
