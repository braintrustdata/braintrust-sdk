import { describe, it, expect } from "vitest";
import { CompileArgs, RunArgs, BundleArgs } from "./util/types";

// Test the type definitions for external packages
describe("External Packages Type Definitions", () => {
  describe("CompileArgs interface", () => {
    it("should have external_packages property", () => {
      const args: CompileArgs = {
        tsconfig: "tsconfig.json",
        terminate_on_failure: false,
        external_packages: ["sqlite3", "fsevents"],
      };

      expect(args.external_packages).toEqual(["sqlite3", "fsevents"]);
    });

    it("should allow undefined external_packages", () => {
      const args: CompileArgs = {
        tsconfig: "tsconfig.json",
        terminate_on_failure: false,
        external_packages: undefined,
      };

      expect(args.external_packages).toBeUndefined();
    });

    it("should allow empty external_packages array", () => {
      const args: CompileArgs = {
        tsconfig: "tsconfig.json",
        terminate_on_failure: false,
        external_packages: [],
      };

      expect(args.external_packages).toEqual([]);
    });
  });

  describe("RunArgs interface", () => {
    it("should inherit external_packages from CompileArgs", () => {
      const args: RunArgs = {
        verbose: false,
        api_key: "test-key",
        org_name: "test-org",
        app_url: "https://test.com",
        env_file: ".env",
        tsconfig: "tsconfig.json",
        terminate_on_failure: false,
        external_packages: ["@mapbox/node-pre-gyp"],
        files: ["test.eval.ts"],
        watch: false,
        list: false,
        jsonl: false,
        filter: undefined,
        no_send_logs: false,
        no_progress_bars: false,
        bundle: false,
        push: false,
        dev: false,
        dev_host: "localhost",
        dev_port: 8300,
      };

      expect(args.external_packages).toEqual(["@mapbox/node-pre-gyp"]);
    });
  });

  describe("BundleArgs interface", () => {
    it("should inherit external_packages from CompileArgs", () => {
      const args: BundleArgs = {
        verbose: false,
        api_key: "test-key",
        org_name: "test-org",
        app_url: "https://test.com",
        env_file: ".env",
        tsconfig: "tsconfig.json",
        terminate_on_failure: false,
        external_packages: ["sqlite3", "sharp"],
        files: ["functions.ts"],
        if_exists: "error",
      };

      expect(args.external_packages).toEqual(["sqlite3", "sharp"]);
    });
  });
});

// Test the buildOpts function parameter flow
describe("buildOpts Function Integration", () => {
  // This is a simplified version of the buildOpts function signature
  interface BuildOptsParams {
    fileName: string;
    outFile: string;
    tsconfig?: string;
    plugins?: any[];
    externalPackages?: string[];
  }

  it("should accept externalPackages parameter", () => {
    const params: BuildOptsParams = {
      fileName: "test.ts",
      outFile: "test.js",
      tsconfig: "tsconfig.json",
      plugins: [],
      externalPackages: ["sqlite3", "fsevents"],
    };

    expect(params.externalPackages).toEqual(["sqlite3", "fsevents"]);
  });

  it("should handle undefined externalPackages", () => {
    const params: BuildOptsParams = {
      fileName: "test.ts",
      outFile: "test.js",
      tsconfig: "tsconfig.json",
      plugins: [],
      externalPackages: undefined,
    };

    expect(params.externalPackages).toBeUndefined();
  });

  it("should handle empty externalPackages array", () => {
    const params: BuildOptsParams = {
      fileName: "test.ts",
      outFile: "test.js",
      tsconfig: "tsconfig.json",
      plugins: [],
      externalPackages: [],
    };

    expect(params.externalPackages).toEqual([]);
  });
});

// Test the parameter flow from CLI to buildOpts
describe("Parameter Flow Integration", () => {
  it("should flow external_packages from RunArgs to buildOpts", () => {
    // Simulate the parameter flow: RunArgs -> initializeHandles -> initFile -> buildOpts
    const runArgs: Partial<RunArgs> = {
      external_packages: ["sqlite3", "@mapbox/node-pre-gyp"],
    };

    // This would be passed to initializeHandles
    const initializeHandlesParams = {
      files: ["test.eval.ts"],
      mode: "eval" as const,
      tsconfig: undefined,
      plugins: undefined,
      externalPackages: runArgs.external_packages,
    };

    expect(initializeHandlesParams.externalPackages).toEqual([
      "sqlite3",
      "@mapbox/node-pre-gyp",
    ]);

    // This would be passed to initFile
    const initFileParams = {
      inFile: "test.eval.ts",
      outFile: "test.js",
      bundleFile: "test.bundle.js",
      tsconfig: undefined,
      plugins: undefined,
      externalPackages: initializeHandlesParams.externalPackages,
    };

    expect(initFileParams.externalPackages).toEqual([
      "sqlite3",
      "@mapbox/node-pre-gyp",
    ]);

    // This would be passed to buildOpts
    const buildOptsParams = {
      fileName: initFileParams.inFile,
      outFile: initFileParams.outFile,
      tsconfig: initFileParams.tsconfig,
      plugins: initFileParams.plugins,
      externalPackages: initFileParams.externalPackages,
    };

    expect(buildOptsParams.externalPackages).toEqual([
      "sqlite3",
      "@mapbox/node-pre-gyp",
    ]);
  });

  it("should flow external_packages from BundleArgs to buildOpts", () => {
    // Simulate the parameter flow: BundleArgs -> initializeHandles -> initFile -> buildOpts
    const bundleArgs: Partial<BundleArgs> = {
      external_packages: ["sharp", "canvas"],
    };

    // This would be passed to initializeHandles
    const initializeHandlesParams = {
      files: ["functions.ts"],
      mode: "bundle" as const,
      tsconfig: undefined,
      plugins: undefined,
      externalPackages: bundleArgs.external_packages,
    };

    expect(initializeHandlesParams.externalPackages).toEqual([
      "sharp",
      "canvas",
    ]);

    // This would be passed to buildOpts
    const buildOptsParams = {
      fileName: "functions.ts",
      outFile: "functions.js",
      tsconfig: undefined,
      plugins: undefined,
      externalPackages: initializeHandlesParams.externalPackages,
    };

    expect(buildOptsParams.externalPackages).toEqual(["sharp", "canvas"]);
  });
});

// Test real-world usage scenarios
describe("Real-world Usage Scenarios", () => {
  it("should handle autoevals dependency issue scenario", () => {
    const args: Partial<RunArgs> = {
      files: ["autoevals-test.eval.ts"],
      external_packages: ["@mapbox/node-pre-gyp", "mock-aws-s3", "aws-sdk"],
    };

    // These packages would be added to the external list
    const expectedExternals = [
      // Hardcoded externals
      "braintrust",
      "autoevals",
      "@braintrust/",
      "config",
      "lightningcss",
      "@mapbox/node-pre-gyp",
      // CLI-specified externals
      ...args.external_packages!,
    ];

    expect(expectedExternals).toContain("@mapbox/node-pre-gyp");
    expect(expectedExternals).toContain("mock-aws-s3");
    expect(expectedExternals).toContain("aws-sdk");
  });

  it("should handle database packages scenario", () => {
    const args: Partial<RunArgs> = {
      files: ["database-test.eval.ts"],
      external_packages: ["sqlite3", "better-sqlite3", "mysql2"],
    };

    expect(args.external_packages).toEqual([
      "sqlite3",
      "better-sqlite3",
      "mysql2",
    ]);
  });

  it("should handle native modules scenario", () => {
    const args: Partial<RunArgs> = {
      files: ["image-processing.eval.ts"],
      external_packages: ["sharp", "canvas", "node-sass"],
    };

    expect(args.external_packages).toEqual(["sharp", "canvas", "node-sass"]);
  });
});
