import { describe, it, expect } from "vitest";
import { ArgumentParser } from "argparse";

// Test the CLI argument parsing for external packages
describe("External Packages CLI Arguments", () => {
  describe("--external-packages flag", () => {
    it("should parse single package", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args(["--external-packages", "sqlite3"]);
      expect(args.external_packages).toEqual(["sqlite3"]);
    });

    it("should parse multiple packages", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "sqlite3",
        "fsevents",
        "@mapbox/node-pre-gyp",
      ]);
      expect(args.external_packages).toEqual([
        "sqlite3",
        "fsevents",
        "@mapbox/node-pre-gyp",
      ]);
    });

    it("should handle scoped packages", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "@scope/package",
        "@another/scoped-package",
      ]);
      expect(args.external_packages).toEqual([
        "@scope/package",
        "@another/scoped-package",
      ]);
    });

    it("should handle packages with special characters", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "package-with-dashes",
        "package.with.dots",
        "@scope/package-with-dashes",
      ]);
      expect(args.external_packages).toEqual([
        "package-with-dashes",
        "package.with.dots",
        "@scope/package-with-dashes",
      ]);
    });

    it("should handle empty flag (no packages)", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args(["--external-packages"]);
      expect(args.external_packages).toEqual([]);
    });

    it("should handle flag not being used", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([]);
      expect(args.external_packages).toBeUndefined();
    });

    it("should handle mixed with other arguments", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });
      parser.add_argument("--verbose", {
        action: "store_true",
        help: "Verbose output",
      });
      parser.add_argument("files", {
        nargs: "*",
        help: "Files to process",
      });

      const args = parser.parse_args([
        "--verbose",
        "--external-packages",
        "sqlite3",
        "fsevents",
        "--",
        "file1.ts",
        "file2.ts",
      ]);

      expect(args.external_packages).toEqual(["sqlite3", "fsevents"]);
      expect(args.verbose).toBe(true);
      expect(args.files).toEqual(["file1.ts", "file2.ts"]);
    });
  });

  describe("Real-world scenarios", () => {
    it("should handle database packages", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "sqlite3",
        "better-sqlite3",
        "mysql2",
        "pg",
      ]);

      expect(args.external_packages).toEqual([
        "sqlite3",
        "better-sqlite3",
        "mysql2",
        "pg",
      ]);
    });

    it("should handle native modules", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "sharp",
        "canvas",
        "node-sass",
        "fsevents",
      ]);

      expect(args.external_packages).toEqual([
        "sharp",
        "canvas",
        "node-sass",
        "fsevents",
      ]);
    });

    it("should handle problematic bundling packages", () => {
      const parser = new ArgumentParser();
      parser.add_argument("--external-packages", {
        nargs: "*",
        help: "Additional packages to mark as external during bundling.",
      });

      const args = parser.parse_args([
        "--external-packages",
        "@mapbox/node-pre-gyp",
        "mock-aws-s3",
        "aws-sdk",
        "node-pre-gyp",
      ]);

      expect(args.external_packages).toEqual([
        "@mapbox/node-pre-gyp",
        "mock-aws-s3",
        "aws-sdk",
        "node-pre-gyp",
      ]);
    });
  });
});
