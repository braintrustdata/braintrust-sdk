/**
 * Test runner for cross-language SDK spec tests.
 *
 * This runner:
 * 1. Loads YAML test specifications from sdkspec/test/
 * 2. Executes SDK calls against the vendor endpoints
 * 3. Validates Braintrust API spans
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import OpenAI from "openai";
import { initLogger, wrapOpenAI } from "braintrust";

interface TestSpec {
  name: string;
  description?: string;
  vendor: string;
  endpoint: string;
  request: Record<string, any>;
  braintrust_span?: Record<string, any>;
}

interface SpecFile {
  name: string;
  tests: TestSpec[];
}

/**
 * Runner for SDK specification tests.
 */
export class SpecTestRunner {
  private specPath: string;
  private spec: SpecFile;

  constructor(specPath: string) {
    this.specPath = specPath;
    this.spec = this.loadSpec();
  }

  /**
   * Load the YAML test specification.
   */
  private loadSpec(): SpecFile {
    const content = fs.readFileSync(this.specPath, "utf-8");
    return yaml.parse(content);
  }

  /**
   * Get project UUID from project name.
   */
  private async getProjectId(projectName: string): Promise<string> {
    const apiKey = process.env.BRAINTRUST_API_KEY;
    if (!apiKey) {
      throw new Error("BRAINTRUST_API_KEY environment variable not set");
    }

    const apiUrl =
      process.env.BRAINTRUST_API_URL || "https://api.braintrust.dev";

    // Fetch projects
    const url = `${apiUrl}/v1/project?project_name=${encodeURIComponent(projectName)}`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    const projects = data.objects || [];

    const matching = projects.filter((p: any) => p.name === projectName);
    if (matching.length === 0) {
      throw new Error(`Project not found: ${projectName}`);
    }

    return matching[0].id;
  }

  /**
   * Fetch span with exponential backoff retry logic.
   *
   * Retries on error with backoff: 30s, then 30s increments
   * Stops when total wait time exceeds 150 seconds.
   */
  private async fetchBraintrustSpan(
    rootSpanId: string,
    projectId: string,
  ): Promise<Record<string, any>> {
    const backoffSeconds = 30;
    let totalWait = 0;
    const maxTotalWait = 150;
    let lastError: Error | null = null;

    while (true) {
      try {
        return await this.fetchBraintrustSpanImpl(rootSpanId, projectId);
      } catch (e) {
        lastError = e as Error;
        if (totalWait > maxTotalWait) {
          break;
        }
        console.log(
          `Span not found yet, waiting ${backoffSeconds}s before retry (total wait: ${totalWait}s)...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, backoffSeconds * 1000),
        );
        totalWait += backoffSeconds;
      }
    }

    // Exceeded max wait time, re-throw the last error
    throw lastError;
  }

  /**
   * Fetch span data from Braintrust API by root_span_id using BTQL.
   *
   * Returns the child span (not the root span itself).
   */
  private async fetchBraintrustSpanImpl(
    rootSpanId: string,
    projectId: string,
  ): Promise<Record<string, any>> {
    const apiKey = process.env.BRAINTRUST_API_KEY;
    if (!apiKey) {
      throw new Error("BRAINTRUST_API_KEY environment variable not set");
    }

    const apiUrl =
      process.env.BRAINTRUST_API_URL || "https://api.braintrust.dev";

    // Use BTQL to query for all spans with this root_span_id
    const url = `${apiUrl}/btql`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // Query for child spans with this root_span_id using BTQL string syntax
    // Filter for spans where root_span_id matches AND span_parents is not null (i.e., not the root)
    const btqlQuery = {
      query: `select: *\nfrom: project_logs('${projectId}')\nfilter: root_span_id = '${rootSpanId}' and span_parents != null\nlimit: 1000`,
      use_columnstore: true,
      use_brainstore: true,
      brainstore_realtime: true,
      api_version: 1,
      fmt: "json",
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(btqlQuery),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch span: ${response.statusText}`);
    }

    const data = await response.json();
    const childSpans = data.data || [];

    // We expect exactly 1 child span (the LLM span)
    if (childSpans.length === 0) {
      throw new Error(`No child spans found with root_span_id: ${rootSpanId}`);
    }
    if (childSpans.length !== 1) {
      throw new Error(
        `Expected exactly 1 child span, found ${childSpans.length}`,
      );
    }

    return childSpans[0];
  }

  /**
   * Validate that Braintrust span data matches expected structure.
   *
   * Recursively walks through the expected structure and validates each value
   * exists in the actual span data.
   */
  private validateBraintrustSpan(
    spanData: Record<string, any>,
    expected: Record<string, any>,
  ): void {
    if (!expected) {
      return;
    }

    const validateValue = (
      actual: any,
      expectedVal: any,
      path: string,
    ): void => {
      if (
        expectedVal !== null &&
        typeof expectedVal === "object" &&
        !Array.isArray(expectedVal)
      ) {
        // For objects, recursively validate each key
        if (typeof actual !== "object" || actual === null) {
          throw new Error(
            `Path ${path}: expected object, got ${typeof actual}`,
          );
        }
        for (const [key, val] of Object.entries(expectedVal)) {
          if (!(key in actual)) {
            throw new Error(
              `Path ${path}.${key}: key not found in actual data`,
            );
          }
          validateValue(actual[key], val, `${path}.${key}`);
        }
      } else if (Array.isArray(expectedVal)) {
        if (Array.isArray(actual)) {
          // Both are arrays - validate each element
          if (expectedVal.length !== actual.length) {
            throw new Error(
              `Path ${path}: list length mismatch, expected=${expectedVal.length}, actual=${actual.length}`,
            );
          }
          for (let i = 0; i < expectedVal.length; i++) {
            validateValue(actual[i], expectedVal[i], `${path}[${i}]`);
          }
        } else if (typeof actual === "object" && actual !== null) {
          // Expected is list of dicts (YAML format for dict key-values like metadata)
          // Actual is a dict - validate each item in the list as a key-value pair
          for (const item of expectedVal) {
            if (typeof item === "object" && item !== null) {
              for (const [key, val] of Object.entries(item)) {
                if (!(key in actual)) {
                  throw new Error(
                    `Path ${path}.${key}: key not found in actual data`,
                  );
                }
                validateValue(actual[key], val, `${path}.${key}`);
              }
            }
          }
        } else {
          throw new Error(
            `Path ${path}: expected list but actual is ${typeof actual}`,
          );
        }
      } else {
        // For scalar values, check equality or regex match
        if (
          typeof expectedVal === "string" &&
          expectedVal.startsWith("regex:")
        ) {
          // Treat as regex pattern - convert actual to string for matching
          const pattern = expectedVal.slice(6); // Remove "regex:" prefix
          const actualStr = String(actual);
          const regex = new RegExp(`^${pattern}$`);
          if (!regex.test(actualStr)) {
            throw new Error(
              `Path ${path}: regex pattern '${pattern}' did not match actual='${actualStr}' (type=${typeof actual})`,
            );
          }
        } else {
          // Exact equality check
          if (actual !== expectedVal) {
            throw new Error(
              `Path ${path}: expected=${expectedVal}, actual=${actual}`,
            );
          }
        }
      }
    };

    // Walk through each top-level key in expected
    for (const [key, expectedVal] of Object.entries(expected)) {
      if (!(key in spanData)) {
        throw new Error(`Top-level key '${key}' not found in span data`);
      }
      validateValue(spanData[key], expectedVal, key);
    }
  }

  /**
   * Run a single test from the specification.
   */
  async runTest(
    testSpec: TestSpec,
    testSuiteName: string = "Unknown",
  ): Promise<void> {
    const { vendor, endpoint, request } = testSpec;

    // Initialize Braintrust logger
    const logger = initLogger({
      projectName: "sdk-spec-test",
      setCurrent: true,
    });

    // Execute the SDK call
    let rootSpanId: string | undefined;

    await logger.traced(
      async (span) => {
        if (vendor === "OpenAI" && endpoint === "completions") {
          // Create a parent span so we can find the llm span
          const client = wrapOpenAI(new OpenAI());
          const response = await client.chat.completions.create(request as any);
          // Store root span ID for later validation
          rootSpanId = span.rootSpanId;
        } else {
          // TODO: Implement other vendor/endpoint combinations
          throw new Error(`Unsupported vendor/endpoint: ${vendor}/${endpoint}`);
        }
      },
      {
        name: `${testSuiteName}.${testSpec.name}`,
      },
    );

    // Flush to send to Braintrust API
    await logger.flush();

    // Validate Braintrust spans (if specified)
    if (testSpec.braintrust_span && rootSpanId) {
      // Fetch actual span data from Braintrust API
      // We need to get the project UUID from the project name
      // TODO: cache project id
      const projectId = await this.getProjectId("sdk-spec-test");

      // Give the API a moment to process the data
      console.log(`Waiting 30s for backend to process span ${rootSpanId}...`);
      await new Promise((resolve) => setTimeout(resolve, 30000));

      const spanData = await this.fetchBraintrustSpan(rootSpanId, projectId);
      console.log(`Got span: ${JSON.stringify(spanData, null, 2)}`);
      this.validateBraintrustSpan(spanData, testSpec.braintrust_span);
    }
  }

  /**
   * Run all tests in the specification.
   */
  async runAllTests(): Promise<void> {
    const testSuiteName = this.spec.name || "Unknown";
    const tests = this.spec.tests || [];

    console.log(`Running test suite: ${testSuiteName}`);
    console.log(`Found ${tests.length} test(s)`);

    console.log(`---- ${testSuiteName} ----`);
    for (const test of tests) {
      const testName = test.name || "Unnamed test";
      console.log(`  Running: ${testName}`);
      try {
        await this.runTest(test, testSuiteName);
        console.log(`    ✓ ${testName} passed`);
      } catch (e) {
        const error = e as Error;
        console.log(`    ✗ ${testName} failed: ${error.message}`);
        throw error;
      }
    }
  }
}

/**
 * Main entry point when run directly.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: ts-node runner.ts <path-to-spec.yaml>");
    process.exit(1);
  }

  const specPath = path.resolve(args[0]);
  const runner = new SpecTestRunner(specPath);
  await runner.runAllTests();
}

// Run if executed directly (ES module check)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Error running tests:", error);
    process.exit(1);
  });
}
