import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as ts from "typescript";
import * as tar from "tar";
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

/**
 * Extracts exports and their signatures from a .d.ts file.
 * For bulk exports (export { A, B, C }), looks up the actual declaration
 * of each symbol to get its true signature, rather than using the export statement.
 */
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

  // First pass: collect all declarations by name
  const declarations = new Map<string, ts.Node>();

  function collectDeclarations(node: ts.Node) {
    let name: string | undefined;

    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isEnumDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((decl) => {
        if (ts.isIdentifier(decl.name)) {
          declarations.set(decl.name.text, node);
        }
      });
    } else if (ts.isModuleDeclaration(node) && node.name) {
      name = node.name.text;
    }

    if (name) {
      declarations.set(name, node);
    }

    ts.forEachChild(node, collectDeclarations);
  }

  collectDeclarations(sourceFile);

  // Helper to check if a node is inside a namespace
  function isInsideNamespace(node: ts.Node): boolean {
    let parent = node.parent;
    while (parent) {
      if (ts.isModuleDeclaration(parent)) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  // Second pass: process exports
  function visit(node: ts.Node) {
    // Skip exports inside namespaces - they're not top-level exports
    if (isInsideNamespace(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Handle: export { foo, bar } or export { foo, bar } from './module'
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((element) => {
          const name = element.name.text;
          const declaration = declarations.get(name);

          exports.set(name, {
            name,
            kind: declaration ? getNodeKind(declaration) : "re-export",
            // Use the actual declaration's signature if found, otherwise just the name
            signature: declaration
              ? declaration.getText(sourceFile)
              : `export { ${name} }`,
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

function getNodeKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "variable";
  if (ts.isModuleDeclaration(node)) return "namespace";
  return "unknown";
}

/**
 * Extracts actual runtime exports from a JavaScript module file
 */
async function extractRuntimeExports(mjsPath: string): Promise<Set<string>> {
  const exports = new Set<string>();

  if (!fs.existsSync(mjsPath)) {
    return exports;
  }

  try {
    // Dynamically import the module
    const module = await import(mjsPath);

    // Get all exported names
    for (const key of Object.keys(module)) {
      exports.add(key);
    }
  } catch (error) {
    console.warn(`Failed to load runtime exports from ${mjsPath}:`, error);
  }

  return exports;
}

/**
 * Verifies that runtime exports match TypeScript declarations
 * Only checks value exports (functions, classes, variables), not pure types
 */
function verifyRuntimeMatchesTypes(
  dtsExports: Map<string, ExportedSymbol>,
  runtimeExports: Set<string>,
  entrypointName: string,
): string[] {
  const errors: string[] = [];

  // Check that non-type exports in .d.ts actually exist at runtime
  for (const [name, symbol] of dtsExports) {
    // Skip pure types (they don't exist at runtime)
    if (
      symbol.kind === "type" ||
      symbol.kind === "interface" ||
      name === "default"
    ) {
      continue;
    }

    // This should be a runtime value - verify it exists
    if (!runtimeExports.has(name)) {
      errors.push(
        `${name} is declared in ${entrypointName}.d.ts as a ${symbol.kind} but is NOT exported in the runtime JavaScript`,
      );
    }
  }

  return errors;
}

function compareExports(
  publishedExports: Map<string, ExportedSymbol>,
  currentExports: Map<string, ExportedSymbol>,
): {
  removed: ExportedSymbol[];
  added: ExportedSymbol[];
  modified: Array<{
    name: string;
    before: string;
    after: string;
    kind: string;
  }>;
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
        kind: publishedSymbol.kind,
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

/**
 * Strips JSDoc comments from a signature.
 * JSDoc comments are documentation only and don't affect the API surface.
 */
function stripJSDocComments(sig: string): string {
  // Remove /** ... */ style comments (including multiline)
  return sig.replace(/\/\*\*[\s\S]*?\*\//g, "").trim();
}

function areSignaturesCompatible(oldSig: string, newSig: string): boolean {
  // Strip JSDoc comments first - they're documentation only
  const oldStripped = stripJSDocComments(oldSig);
  const newStripped = stripJSDocComments(newSig);

  // Normalize whitespace for comparison
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

  const oldNorm = normalize(oldStripped);
  const newNorm = normalize(newStripped);

  // If they're exactly the same, they're compatible
  if (oldNorm === newNorm) {
    return true;
  }

  // Strategy: Normalize both signatures by removing optional markers and default values,
  // then compare. If the normalized versions match, and the new signature only adds
  // optionality (either via ? or default values), it's backward compatible.

  // Step 1: Remove default values and normalize optional parameters
  // This regex removes default values like "= {}" or "= defaultValue"
  const removeDefaults = (s: string) =>
    s.replace(/=\s*\{[^}]*\}/g, "= {}").replace(/=\s*[^,)}]+/g, "");

  // Step 2: Create a "base" version of each signature by removing optionality
  // This allows us to compare the core structure
  const createBaseSignature = (s: string): string => {
    let base = s;
    // Remove default values first (they come after optional markers)
    base = removeDefaults(base);
    // Remove optional markers from parameters (param?: Type -> param: Type)
    // But preserve them in object types for now
    base = base.replace(/(\w+)\?:\s*/g, "$1: ");
    // Remove optional markers from object properties (field?: Type -> field: Type)
    // This is tricky - we need to handle nested objects, so we do a simple replacement
    // that works for most cases
    base = base.replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)\?:\s*/g, "$1: ");
    return base;
  };

  const oldBase = createBaseSignature(oldNorm);
  const newBase = createBaseSignature(newNorm);

  // If base signatures match, check if only optionality was added
  if (oldBase === newBase) {
    // Base structures are identical - check if new signature only adds optionality
    // This means:
    // 1. Parameters that were required became optional (param: Type -> param?: Type or param?: Type = ...)
    // 2. Object properties gained optional markers (field: Type -> field?: Type)
    // 3. Default values were added

    // If old has a required param and new has it as optional, that's compatible
    // Pattern: old has "param: Type" and new has "param?: Type" or "param?: Type = ..."
    // We already normalized these in createBaseSignature, so if bases match,
    // the differences are only in optionality markers or defaults, which are compatible.
    return true;
  }

  // Step 3: Check for the specific pattern where a required parameter becomes optional
  // Pattern: old has "param: Type" and new has "param?: Type" or "param?: Type = defaultValue"
  // This requires matching parameter names, which is complex with nested types.

  // Step 4: Handle the case where object types gain optional fields
  // When object types gain optional fields, the base signatures won't match exactly
  // because new fields are added. We need a different strategy.

  // Extract the core signature parts (name, params region, return type)
  const extractCoreParts = (s: string) => {
    // Match: name(parameters): returnType
    const match = s.match(/^(\w+)\s*\(([^)]*)\)\s*:\s*(.+)$/);
    if (match) {
      return {
        name: match[1],
        params: match[2],
        returnType: match[3],
      };
    }
    // For class methods, pattern might be slightly different
    // Try: public method(parameters): returnType
    const methodMatch = s.match(
      /(?:public\s+)?(\w+)\s*\(([^)]*)\)\s*:\s*(.+)$/,
    );
    if (methodMatch) {
      return {
        name: methodMatch[1],
        params: methodMatch[2],
        returnType: methodMatch[3],
      };
    }
    return null;
  };

  const oldParts = extractCoreParts(oldNorm);
  const newParts = extractCoreParts(newNorm);

  if (oldParts && newParts) {
    // Check if name and return type match
    if (
      oldParts.name === newParts.name &&
      oldParts.returnType === newParts.returnType
    ) {
      // Parameters changed, but name and return type match
      // This is a strong signal that changes are likely backward-compatible
      // (e.g., adding optional parameters or optional fields to object types)

      // Count parameters (simple comma count at top level)
      const countParams = (params: string): number => {
        if (!params.trim()) return 0;
        // Count commas at the top level (not inside brackets/braces/parens)
        let depth = 0;
        let count = 0;
        for (let i = 0; i < params.length; i++) {
          const char = params[i];
          if (char === "<" || char === "{" || char === "(") {
            depth++;
          } else if (char === ">" || char === "}" || char === ")") {
            depth--;
          } else if (char === "," && depth === 0) {
            count++;
          }
        }
        return count + 1; // +1 because N commas means N+1 params
      };

      const oldParamCount = countParams(oldParts.params);
      const newParamCount = countParams(newParts.params);

      // If parameter counts are the same or new has at most one more parameter,
      // consider it compatible. This covers:
      // 1. Required param -> optional param (same count)
      // 2. Adding optional parameter at end (+1 count)
      // 3. Object types gaining optional fields (same count, different content)
      if (
        newParamCount >= oldParamCount &&
        newParamCount <= oldParamCount + 1
      ) {
        return true;
      }
    }
  }

  // If we can't determine compatibility, be conservative
  return false;
}

/**
 * Truncates a signature for display, showing first N chars and
 * handling multiline signatures better
 */
function truncateSignature(sig: string, maxLength: number = 150): string {
  // Normalize whitespace
  const normalized = sig.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.substring(0, maxLength) + "...";
}

/**
 * Finds the first difference between two strings
 */
function findDifference(before: string, after: string): string {
  const maxLen = Math.max(before.length, after.length);
  let diffStart = -1;

  for (let i = 0; i < maxLen; i++) {
    if (before[i] !== after[i]) {
      diffStart = i;
      break;
    }
  }

  if (diffStart === -1) {
    return "Strings are identical after normalization";
  }

  const contextStart = Math.max(0, diffStart - 50);
  const contextEnd = Math.min(maxLen, diffStart + 200);

  const beforeContext = before.substring(contextStart, contextEnd);
  const afterContext = after.substring(contextStart, contextEnd);

  return `First difference at position ${diffStart}:\n    Before: ...${beforeContext}...\n    After:  ...${afterContext}...`;
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

    // Extract tarball using tar package (cross-platform)
    await tar.x({
      file: tarballPath,
      cwd: tempDir,
    });
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

  test("should not regress public API surface for all entrypoints", async () => {
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

      // Verify that current runtime exports match .d.ts declarations
      const currentMjsPath = path
        .join(__dirname, "..", entrypoint.typesPath)
        .replace(/\.d\.ts$/, ".mjs");
      if (fs.existsSync(currentMjsPath)) {
        const runtimeExports = await extractRuntimeExports(currentMjsPath);
        const runtimeErrors = verifyRuntimeMatchesTypes(
          currentExports,
          runtimeExports,
          entrypoint.name,
        );
        if (runtimeErrors.length > 0) {
          failures.push(
            `[${entrypoint.name}] Runtime exports don't match TypeScript declarations:\n` +
              runtimeErrors.map((e) => `  - ${e}`).join("\n"),
          );
        }
      }

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
                .map((m) => {
                  // For modified exports, show more context and find the actual difference
                  const beforeNorm = m.before.replace(/\s+/g, " ").trim();
                  const afterNorm = m.after.replace(/\s+/g, " ").trim();

                  if (beforeNorm === afterNorm) {
                    return `  - ${m.name} (${m.kind})\n    Note: Signatures appear identical after normalization (possible whitespace-only change)`;
                  }

                  return `  - ${m.name} (${m.kind})\n    ${findDifference(beforeNorm, afterNorm)}`;
                })
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
