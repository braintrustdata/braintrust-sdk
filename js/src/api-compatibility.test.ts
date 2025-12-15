import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as ts from "typescript";
import type { Options } from "tsup";

/**
 * API Compatibility Test
 *
 * This test ensures that the public TypeScript API surface of the braintrust package
 * doesn't regress between versions, respecting semver rules:
 *
 * - Major version bumps: Breaking changes are allowed
 * - Minor version bumps: Only additions are allowed (no breaking changes)
 * - Patch version bumps: Only additions are allowed (no breaking changes)
 *
 * ## How It Works
 *
 * 1. Downloads the latest published version from npm
 * 2. Extracts the .d.ts files for each entrypoint (main, browser, dev, util)
 * 3. Parses both published and current .d.ts files using TypeScript Compiler API
 * 4. Compares exported symbols (functions, classes, interfaces, types, etc.)
 * 5. Fails if breaking changes are detected in non-major version bumps
 *
 * ## Running the Test
 *
 * ```bash
 * cd sdk/js
 * pnpm build  # Must build first to generate .d.ts files
 * pnpm test src/api-compatibility.test.ts
 * ```
 *
 * ## What Gets Checked
 *
 * For each entrypoint, the test compares:
 * - Removed exports (breaking change)
 * - Modified export signatures (breaking change)
 * - Added exports (non-breaking, logged for info)
 *
 * ## Technology
 *
 * Uses the TypeScript Compiler API (typescript package), a mature and well-tested
 * tool maintained by Microsoft. This approach is more reliable than custom parsing
 * and handles complex TypeScript syntax correctly.
 */

/**
 * Extracts entrypoints from tsup.config.ts
 * Reads the config and identifies all builds that generate .d.ts files
 */
async function getEntrypointsFromTsupConfig(): Promise<
  Array<{ name: string; typesPath: string }>
> {
  const configPath = path.join(__dirname, "..", "tsup.config.ts");

  // Dynamically import the tsup config
  const configModule = await import(configPath);
  const config: Options | Options[] = configModule.default;

  const configs = Array.isArray(config) ? config : [config];
  const entrypoints: Array<{ name: string; typesPath: string }> = [];

  for (const cfg of configs) {
    // Skip configs without dts enabled
    if (!cfg.dts) continue;

    const entry = cfg.entry;
    const outDir = cfg.outDir || "dist";

    if (Array.isArray(entry)) {
      for (const entryFile of entry) {
        const name = getEntrypointName(entryFile, outDir);
        const typesPath = getTypesPath(entryFile, outDir);
        entrypoints.push({ name, typesPath });
      }
    } else if (typeof entry === "object") {
      // entry is a record like { main: 'src/index.ts' }
      for (const [key, entryFile] of Object.entries(entry)) {
        const name = key;
        const typesPath = getTypesPath(String(entryFile), outDir);
        entrypoints.push({ name, typesPath });
      }
    }
  }

  return entrypoints;
}

/**
 * Determines the entrypoint name from the entry file path
 */
function getEntrypointName(entryFile: string, outDir: string): string {
  const basename = path.basename(entryFile, path.extname(entryFile));

  // Map common patterns to friendly names
  if (entryFile.includes("src/index.ts")) return "main";
  if (entryFile.includes("src/browser.ts")) return "browser";
  if (entryFile.includes("dev/index.ts")) return "dev";
  if (entryFile.includes("util/index.ts")) return "util";

  // Default to basename
  return basename;
}

/**
 * Constructs the .d.ts path from entry file and output directory
 */
function getTypesPath(entryFile: string, outDir: string): string {
  const basename = path.basename(entryFile, path.extname(entryFile));
  return path.join(outDir, `${basename}.d.ts`);
}

// Will be populated in beforeAll
let ENTRYPOINTS: Array<{ name: string; typesPath: string }> = [];

interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
}

interface ExportedSymbol {
  name: string;
  kind: string;
  signature: string;
}

function parseVersion(version: string): VersionInfo {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function getVersionBumpType(
  published: VersionInfo,
  current: VersionInfo,
): "major" | "minor" | "patch" | "none" {
  if (current.major > published.major) return "major";
  if (current.minor > published.minor) return "minor";
  if (current.patch > published.patch) return "patch";
  return "none";
}

function extractExportsFromDts(filePath: string): Map<string, ExportedSymbol> {
  const exports = new Map<string, ExportedSymbol>();

  if (!fs.existsSync(filePath)) {
    return exports;
  }

  const sourceText = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  function visit(node: ts.Node) {
    // Check if this is an export declaration
    if (ts.isExportDeclaration(node)) {
      // Handle: export { foo, bar } from './module'
      // These are re-exports and should be included
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((element) => {
          const name = element.name.text;
          exports.set(name, {
            name,
            kind: "export",
            signature: node.getText(sourceFile),
          });
        });
      }
    } else if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      // Handle direct exports with 'export' keyword
      let name: string | undefined;
      let kind: string = "unknown";
      const signature: string = node.getText(sourceFile);

      if (ts.isFunctionDeclaration(node) && node.name) {
        name = node.name.text;
        kind = "function";
      } else if (ts.isClassDeclaration(node) && node.name) {
        name = node.name.text;
        kind = "class";
      } else if (ts.isInterfaceDeclaration(node)) {
        name = node.name.text;
        kind = "interface";
      } else if (ts.isTypeAliasDeclaration(node)) {
        name = node.name.text;
        kind = "type";
      } else if (ts.isEnumDeclaration(node)) {
        name = node.name.text;
        kind = "enum";
      } else if (ts.isVariableStatement(node)) {
        // Handle: export const foo = ...
        node.declarationList.declarations.forEach((decl) => {
          if (ts.isIdentifier(decl.name)) {
            const varName = decl.name.text;
            exports.set(varName, {
              name: varName,
              kind: "variable",
              signature: node.getText(sourceFile),
            });
          }
        });
        return; // Don't add to exports again below
      } else if (ts.isModuleDeclaration(node) && node.name) {
        name = node.name.text;
        kind = "namespace";
      }

      if (name) {
        exports.set(name, { name, kind, signature });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

function compareExports(
  publishedExports: Map<string, ExportedSymbol>,
  currentExports: Map<string, ExportedSymbol>,
): {
  removed: ExportedSymbol[];
  added: ExportedSymbol[];
  modified: Array<{ name: string; before: string; after: string }>;
} {
  const removed: ExportedSymbol[] = [];
  const added: ExportedSymbol[] = [];
  const modified: Array<{ name: string; before: string; after: string }> = [];

  // Check for removed or modified exports
  for (const [name, publishedSymbol] of publishedExports) {
    const currentSymbol = currentExports.get(name);
    if (!currentSymbol) {
      removed.push(publishedSymbol);
    } else if (
      !areSignaturesCompatible(
        publishedSymbol.signature,
        currentSymbol.signature,
      )
    ) {
      modified.push({
        name,
        before: publishedSymbol.signature,
        after: currentSymbol.signature,
      });
    }
  }

  // Check for added exports
  for (const [name, currentSymbol] of currentExports) {
    if (!publishedExports.has(name)) {
      added.push(currentSymbol);
    }
  }

  return { removed, added, modified };
}

function areSignaturesCompatible(oldSig: string, newSig: string): boolean {
  // Normalize whitespace for comparison
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

  const oldNorm = normalize(oldSig);
  const newNorm = normalize(newSig);

  // If they're exactly the same, they're compatible
  if (oldNorm === newNorm) {
    return true;
  }

  // Check if the only changes are making parameters optional (adding ?)
  // This is a simplified heuristic - in practice, you might want more sophisticated analysis
  // For now, we'll be conservative and consider any change as potentially breaking
  return false;
}

describe("API Compatibility", () => {
  let tempDir: string;
  let publishedVersion: string;
  let currentVersion: string;
  let versionBumpType: "major" | "minor" | "patch" | "none";

  beforeAll(async () => {
    // Load entrypoints from tsup config
    ENTRYPOINTS = await getEntrypointsFromTsupConfig();
    console.log(
      `Loaded ${ENTRYPOINTS.length} entrypoints from tsup.config.ts:`,
      ENTRYPOINTS.map((e) => e.name).join(", "),
    );

    // Get current version from package.json
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    currentVersion = packageJson.version;

    // Get latest published version from npm
    try {
      publishedVersion = execSync("npm view braintrust version", {
        encoding: "utf-8",
      }).trim();
    } catch {
      console.warn(
        "Could not fetch published version from npm. Skipping API compatibility test.",
      );
      publishedVersion = "";
      return;
    }

    // Determine version bump type
    const publishedVersionInfo = parseVersion(publishedVersion);
    const currentVersionInfo = parseVersion(currentVersion);
    versionBumpType = getVersionBumpType(
      publishedVersionInfo,
      currentVersionInfo,
    );

    console.log(`Published version: ${publishedVersion}`);
    console.log(`Current version: ${currentVersion}`);
    console.log(`Version bump type: ${versionBumpType}`);

    // Create temp directory for downloaded package
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "braintrust-api-test-"));

    // Download and extract published package
    const packOutput = execSync(`npm pack braintrust@${publishedVersion}`, {
      encoding: "utf-8",
      cwd: tempDir,
    }).trim();

    const tarballPath = path.join(tempDir, packOutput);

    // Extract tarball
    execSync(`tar -xzf "${tarballPath}" -C "${tempDir}"`, { stdio: "pipe" });
  }, 30000); // 30 second timeout for downloading

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should be able to download published version", () => {
    if (!publishedVersion) {
      console.log("Skipping: No published version available");
      return;
    }

    expect(publishedVersion).toBeTruthy();
    expect(tempDir).toBeTruthy();
    expect(fs.existsSync(path.join(tempDir, "package"))).toBe(true);
  });

  test("should not regress public API surface for all entrypoints", () => {
    if (!publishedVersion) {
      console.log("Skipping test: No published version available");
      return;
    }

    // Track any failures to report them all at once
    const failures: string[] = [];

    for (const entrypoint of ENTRYPOINTS) {
      const publishedTypesPath = path.join(
        tempDir,
        "package",
        entrypoint.typesPath,
      );
      const currentTypesPath = path.join(__dirname, "..", entrypoint.typesPath);

      // Check if both files exist
      if (!fs.existsSync(publishedTypesPath)) {
        console.warn(
          `Published types not found: ${publishedTypesPath}. Skipping ${entrypoint.name}.`,
        );
        continue;
      }

      if (!fs.existsSync(currentTypesPath)) {
        throw new Error(
          `Current types not found: ${currentTypesPath}. Build the package first with: pnpm build`,
        );
      }

      // Extract exports from both versions
      const publishedExports = extractExportsFromDts(publishedTypesPath);
      const currentExports = extractExportsFromDts(currentTypesPath);

      console.log(
        `${entrypoint.name}: Published exports: ${publishedExports.size}, Current exports: ${currentExports.size}`,
      );

      // Compare the exports
      const comparison = compareExports(publishedExports, currentExports);

      // Log additions
      if (comparison.added.length > 0) {
        console.log(
          `${entrypoint.name}: Added ${comparison.added.length} exports:`,
          comparison.added.map((e) => e.name).join(", "),
        );
      }

      // Check for breaking changes
      const hasBreakingChanges =
        comparison.removed.length > 0 || comparison.modified.length > 0;

      if (hasBreakingChanges && versionBumpType !== "major") {
        const errors: string[] = [];

        if (comparison.removed.length > 0) {
          errors.push(
            `Removed exports (${comparison.removed.length}):\n` +
              comparison.removed
                .map((e) => `  - ${e.name} (${e.kind})`)
                .join("\n"),
          );
        }

        if (comparison.modified.length > 0) {
          errors.push(
            `Modified exports (${comparison.modified.length}):\n` +
              comparison.modified
                .map(
                  (m) =>
                    `  - ${m.name}\n    Before: ${m.before.substring(0, 100)}...\n    After: ${m.after.substring(0, 100)}...`,
                )
                .join("\n"),
          );
        }

        failures.push(
          `[${entrypoint.name}] Breaking changes detected, but version bump is only ${versionBumpType}:\n` +
            errors.join("\n\n"),
        );
      }

      // For major version bumps, just log the changes but don't fail
      if (versionBumpType === "major" && hasBreakingChanges) {
        console.log(
          `${entrypoint.name}: Breaking changes detected (allowed for major version):`,
        );
        if (comparison.removed.length > 0) {
          console.log(
            `  Removed: ${comparison.removed.map((e) => e.name).join(", ")}`,
          );
        }
        if (comparison.modified.length > 0) {
          console.log(
            `  Modified: ${comparison.modified.map((m) => m.name).join(", ")}`,
          );
        }
      }
    }

    // If there were any failures, throw them all at once
    if (failures.length > 0) {
      throw new Error(
        `Breaking changes detected in ${failures.length} entrypoint(s):\n\n` +
          failures.join("\n\n") +
          `\n\nFor a ${versionBumpType} version bump, only additions are allowed, not removals or modifications.\n` +
          `Either:\n` +
          `  1. Bump to a major version if these breaking changes are intentional\n` +
          `  2. Restore the removed/modified APIs to maintain backward compatibility`,
      );
    }
  });
});
