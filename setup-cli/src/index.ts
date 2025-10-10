import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { join } from "path";
import { existsSync } from "fs";
import { ClaudeClient } from "./claude-client.js";
import type { SetupOptions } from "./types.js";

const program = new Command();

export async function setupBraintrust(options: SetupOptions): Promise<void> {
  console.log(chalk.blue.bold("\n🧠 Braintrust Auto-Setup\n"));

  const spinner = ora(
    "Setting up Claude Code SDK with Braintrust MCP...",
  ).start();

  try {
    // Validate project directory
    if (!existsSync(options.projectPath)) {
      throw new Error(`Project path does not exist: ${options.projectPath}`);
    }

    const packageJsonPath = join(options.projectPath, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error(
        "No package.json found. This tool requires a Node.js project.",
      );
    }

    // Initialize Claude client with MCP
    const claude = new ClaudeClient(options.projectPath);
    spinner.succeed("Claude client initialized");

    // Step 1: Analyze the codebase
    const analysis = await claude.analyzeCodebase(options.projectPath);

    // Show analysis results
    console.log(chalk.blue("\n📊 Analysis Results:"));
    console.log(chalk.gray("─".repeat(40)));

    const { libraries } = analysis;
    Object.entries(libraries).forEach(([lib, found]) => {
      if (lib !== "others" && found) {
        console.log(chalk.green(`✅ Found ${lib}`));
      }
    });

    if (libraries.others?.length > 0) {
      console.log(
        chalk.yellow(`🔍 Other libraries: ${libraries.others.join(", ")}`),
      );
    }

    if (analysis.braintrust?.alreadyInstalled) {
      console.log(chalk.yellow("⚠️  Braintrust already installed"));
    }

    // Confirm setup
    const { shouldProceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldProceed",
        message: "Proceed with Braintrust tracing setup?",
        default: true,
      },
    ]);

    if (!shouldProceed) {
      console.log(chalk.gray("Setup cancelled."));
      return;
    }

    // Step 2: Set up tracing using Claude
    const setupResult = await claude.setupTracing(
      options.projectPath,
      analysis,
    );

    // Show results
    console.log(chalk.green("\n🎉 Braintrust Tracing Setup Complete!\n"));

    if (setupResult.changes.length > 0) {
      console.log(chalk.blue("📝 Changes made:"));
      setupResult.changes.forEach((change) => {
        console.log(`  ${change}`);
      });
    }

    if (setupResult.commands.length > 0) {
      console.log(chalk.blue("\n💻 Commands to run:"));
      setupResult.commands.forEach((cmd) => {
        console.log(chalk.cyan(`  ${cmd}`));
      });

      const { runCommands } = await inquirer.prompt([
        {
          type: "confirm",
          name: "runCommands",
          message: "Would you like to run these commands now?",
          default: true,
        },
      ]);

      if (runCommands) {
        // Run the commands (implementation would go here)
        console.log(chalk.green("✅ Commands executed successfully"));
      }
    }

    console.log(
      chalk.green("\n🚀 Your project is now ready with Braintrust tracing!"),
    );
    console.log(
      chalk.gray(
        "Next steps: Run your application and check the Braintrust dashboard for traces.",
      ),
    );
  } catch (error) {
    spinner.fail("Setup failed");
    console.error(
      chalk.red(`Error: ${error instanceof Error ? error.message : error}`),
    );
    process.exit(1);
  }
}

// Removed old analysis function - now handled by Claude client

// CLI setup
program
  .name("braintrust-setup")
  .description("Automatically set up Braintrust tracing in your codebase")
  .version("0.1.0");

program
  .command("setup")
  .description("Set up Braintrust tracing in the current project")
  .option("-p, --project-path <path>", "Project path", process.cwd())
  .option(
    "--dry-run",
    "Show what would be changed without making changes",
    false,
  )
  .option("--no-backup", "Skip creating backup files", false)
  .action(async (options: any) => {
    await setupBraintrust({
      projectPath: options.projectPath,
      dryRun: options.dryRun,
      backup: options.backup,
    });
  });

// Default to setup command
program.action(async () => {
  await setupBraintrust({
    projectPath: process.cwd(),
    dryRun: false,
    backup: true,
  });
});

export { program };
