#!/usr/bin/env node

import { parseArgs } from "util";
import { run } from "./runner";
import { DEFAULT_GLOB_PATTERN, OUTPUT_MODES, OutputMode } from "./constants";

const showHelp = () => {
  console.log(`
Usage: pnpm dlx tsx runner/cli.ts [options]

Options:
  -g, --glob <pattern>    File glob pattern (default: "${DEFAULT_GLOB_PATTERN}")
  -f, --filter <regex>    Test example name filter regex
  -o, --output <mode>     Output mode: "files" or "print" (default: "files")
  -h, --help             Show this help message

Examples:
  pnpm dlx tsx runner/cli.ts --glob "langchain.ts"
  pnpm dlx tsx runner/cli.ts --glob "otel/*.ts" --filter "test.*async"
  pnpm dlx tsx runner/cli.ts --glob "*.ts" --output print | pbcopy
`);
};

const main = async () => {
  try {
    // Parse command line arguments
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        glob: {
          type: "string",
          short: "g",
          default: DEFAULT_GLOB_PATTERN,
        },
        filter: {
          type: "string",
          short: "f",
        },
        output: {
          type: "string",
          short: "o",
          default: OUTPUT_MODES.FILES,
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
    });

    // Show help if requested
    if (values.help) {
      showHelp();
      process.exit(0);
    }

    // Validate output mode
    const rawOutputMode = values.output || OUTPUT_MODES.FILES;
    let outputMode: OutputMode;
    if (rawOutputMode === OUTPUT_MODES.FILES) {
      outputMode = OUTPUT_MODES.FILES;
    } else if (rawOutputMode === OUTPUT_MODES.PRINT) {
      outputMode = OUTPUT_MODES.PRINT;
    } else {
      console.error(
        `Invalid output mode: ${rawOutputMode}. Must be "${OUTPUT_MODES.FILES}" or "${OUTPUT_MODES.PRINT}"`,
      );
      process.exit(1);
    }

    // Run the tests
    await run({
      glob: values.glob || DEFAULT_GLOB_PATTERN,
      filter: values.filter,
      output: outputMode,
    });
  } catch (error) {
    console.error("Fatal error in runner:", error);
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
};

// Only run if this is the main module
if (require.main === module) {
  main();
}

export { main };
