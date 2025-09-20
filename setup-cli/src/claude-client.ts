import { query } from "@anthropic-ai/claude-code";
import type { SetupOptions } from "./types.js";
import {
  BRAINTRUST_SETUP_PROMPT,
  PROJECT_ANALYSIS_PROMPT,
  IMPLEMENTATION_PROMPT,
} from "./prompts.js";
import { writeFileSync } from "fs";
import { join } from "path";

export class ClaudeClient {
  private mcpConfigPath: string;

  constructor(projectPath: string) {
    // Create MCP config for Braintrust
    this.mcpConfigPath = join(projectPath, ".mcp.json");
    this.createMCPConfig();
  }

  private createMCPConfig() {
    const mcpConfig = {
      mcpServers: {
        braintrust: {
          type: "sse" as const,
          url: "https://api.braintrust.dev/mcp",
          // Authentication will be handled by Claude Code's OAuth flow
        },
      },
    };

    writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  async analyzeCodebase(projectPath: string): Promise<any> {
    const ora = await import("ora");
    const chalk = await import("chalk");

    const fileSpinner = ora.default("Reading project files...").start();
    const files = await this.readProjectFiles(projectPath);
    fileSpinner.succeed(`Found ${files.length} relevant files`);

    const prompt = `${PROJECT_ANALYSIS_PROMPT}

Project path: ${projectPath}

Here are the relevant files from the project:

${files.map((f) => `**${f.path}**:\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")}

Please analyze this codebase and return the analysis in the specified JSON format. Use the search_docs tool to get relevant Braintrust examples.`;

    let analysis = {};
    console.log(chalk.default.blue("\n🔍 Claude Analysis Stream:"));
    console.log(chalk.default.gray("─".repeat(60)));

    for await (const message of query({
      prompt,
      options: {
        mcpConfig: this.mcpConfigPath,
        allowedTools: [
          "mcp__braintrust__search_docs",
          "mcp__braintrust__list_recent_objects",
        ],
      },
    })) {
      if (message.type === "text") {
        // Print raw Claude output like Claude Code
        process.stdout.write(message.text);
      } else if (message.type === "tool_use") {
        console.log(chalk.default.cyan(`\n🔧 Using tool: ${message.tool}`));
        console.log(
          chalk.default.gray(
            `   Input: ${JSON.stringify(message.input, null, 2)}`,
          ),
        );
      } else if (message.type === "tool_result") {
        console.log(chalk.default.green(`✓ Tool completed`));
        if (
          message.result &&
          typeof message.result === "string" &&
          message.result.length < 200
        ) {
          console.log(
            chalk.default.gray(`   Result: ${message.result.slice(0, 200)}...`),
          );
        }
      } else if (message.type === "result" && message.subtype === "success") {
        console.log(chalk.default.green("\n✓ Analysis complete"));
        analysis = this.parseAnalysisResponse(message.result);
        break;
      } else if (message.type === "error") {
        console.log(
          chalk.default.red(`\n❌ Analysis failed: ${message.error}`),
        );
        console.log(chalk.default.yellow("Using fallback analysis..."));
        // Fallback to basic analysis
        analysis = this.createFallbackAnalysis(files);
        break;
      }
    }

    return analysis;
  }

  async setupTracing(
    projectPath: string,
    analysis: any,
  ): Promise<{
    changes: string[];
    filesToModify: { path: string; content: string }[];
    commands: string[];
  }> {
    const chalk = await import("chalk");

    const prompt = `${BRAINTRUST_SETUP_PROMPT}

${IMPLEMENTATION_PROMPT}

Based on this analysis:
\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

Please implement Braintrust tracing for this codebase. Use the MCP tools to search for relevant documentation and examples.

Project path: ${projectPath}

Please provide:
1. List of changes to be made
2. Modified file contents
3. Commands to run

Format your response as JSON with keys: changes, filesToModify, commands`;

    let result = {
      changes: [],
      filesToModify: [],
      commands: [],
    };

    console.log(chalk.default.blue("\n⚙️  Claude Setup Stream:"));
    console.log(chalk.default.gray("─".repeat(60)));

    for await (const message of query({
      prompt,
      options: {
        mcpConfig: this.mcpConfigPath,
        allowedTools: [
          "mcp__braintrust__search_docs",
          "mcp__braintrust__list_recent_objects",
          "mcp__braintrust__resolve_object",
        ],
      },
    })) {
      if (message.type === "text") {
        // Print raw Claude output like Claude Code
        process.stdout.write(message.text);
      } else if (message.type === "tool_use") {
        console.log(chalk.default.cyan(`\n🔧 Using tool: ${message.tool}`));
        console.log(
          chalk.default.gray(
            `   Input: ${JSON.stringify(message.input, null, 2)}`,
          ),
        );
      } else if (message.type === "tool_result") {
        console.log(chalk.default.green(`✓ Tool completed`));
        if (
          message.result &&
          typeof message.result === "string" &&
          message.result.length < 200
        ) {
          console.log(
            chalk.default.gray(`   Result: ${message.result.slice(0, 200)}...`),
          );
        }
      } else if (message.type === "result" && message.subtype === "success") {
        console.log(chalk.default.green("\n✓ Setup planning complete"));
        result = this.parseImplementationResponse(message.result);
        break;
      } else if (message.type === "error") {
        console.log(chalk.default.red(`\n❌ Setup failed: ${message.error}`));
        break;
      }
    }

    return result;
  }

  private async readProjectFiles(
    projectPath: string,
  ): Promise<{ path: string; content: string }[]> {
    const fs = await import("fs/promises");
    const path = await import("path");

    const files: { path: string; content: string }[] = [];

    try {
      // Read package.json
      const packageJsonPath = path.join(projectPath, "package.json");
      const packageJson = await fs.readFile(packageJsonPath, "utf-8");
      files.push({ path: "package.json", content: packageJson });

      // Read common entry points
      const entryPoints = [
        "src/index.ts",
        "src/index.js",
        "index.ts",
        "index.js",
        "app.ts",
        "app.js",
        "main.ts",
        "main.js",
      ];

      for (const entryPoint of entryPoints) {
        const filePath = path.join(projectPath, entryPoint);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          files.push({ path: entryPoint, content });
          break; // Only read first found entry point
        } catch {
          // File doesn't exist, try next
        }
      }

      // Look for AI-related files
      const aiPatterns = [
        "**/*openai*",
        "**/*anthropic*",
        "**/*langchain*",
        "**/*ai*",
      ];
      // This is simplified - in reality you'd use glob patterns
    } catch (error) {
      console.error("Error reading project files:", error);
    }

    return files;
  }

  private parseAnalysisResponse(result: string): any {
    // Try to extract JSON from Claude's response
    const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);

    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.error("Failed to parse analysis JSON:", e);
      }
    }

    // Fallback to basic analysis
    return this.createFallbackAnalysis([]);
  }

  private createFallbackAnalysis(
    files: { path: string; content: string }[],
  ): any {
    // Basic analysis based on package.json if available
    const packageJsonFile = files.find((f) => f.path === "package.json");
    let dependencies = {};

    if (packageJsonFile) {
      try {
        const pkg = JSON.parse(packageJsonFile.content);
        dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      } catch (e) {
        // Ignore parse errors
      }
    }

    return {
      libraries: {
        openai: !!dependencies["openai"],
        anthropic: !!dependencies["@anthropic-ai/sdk"],
        langchain:
          !!dependencies["langchain"] || !!dependencies["@langchain/core"],
        vercel_ai: !!dependencies["ai"],
        others: [],
      },
      project: {
        type: "unknown",
        language: "typescript",
        packageManager: "npm",
      },
      braintrust: {
        alreadyInstalled: !!dependencies["braintrust"],
        alreadyConfigured: false,
      },
      entryPoints: ["src/index.ts"],
      recommendations: ["Add Braintrust tracing"],
    };
  }

  private parseImplementationResponse(result: string): {
    changes: string[];
    filesToModify: { path: string; content: string }[];
    commands: string[];
  } {
    // Try to parse JSON response
    const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);

    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.error("Failed to parse implementation JSON:", e);
      }
    }

    // Fallback - extract information from text
    const lines = result.split("\n");
    const changes: string[] = [];
    const commands: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("- ") || line.trim().match(/^\d+\./)) {
        changes.push(line.trim());
      }
      if (
        line.includes("npm install") ||
        line.includes("pnpm install") ||
        line.includes("yarn add")
      ) {
        commands.push(line.trim());
      }
    }

    return {
      changes: changes.length > 0 ? changes : ["Setup completed by Claude"],
      filesToModify: [],
      commands: commands.length > 0 ? commands : ["npm install braintrust"],
    };
  }
}
