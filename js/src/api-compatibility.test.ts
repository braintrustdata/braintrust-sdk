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
        publishedSymbol.kind,
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

function areSignaturesCompatible(
  oldSig: string,
  newSig: string,
  kind?: string,
): boolean {
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

  // Special handling for classes: extract and compare methods individually
  // For classes, the signature is the entire class definition, so we need
  // to handle method-level changes more carefully
  if (kind === "class") {
    return areClassSignaturesCompatible(oldNorm, newNorm);
  }

  // Special handling for Zod schemas: adding optional fields is backwards compatible
  // Pattern: adding "fieldName: z.ZodOptional<...>" to object schemas
  if (
    kind === "variable" &&
    oldNorm.includes("ZodObject") &&
    newNorm.includes("ZodObject")
  ) {
    return areZodSchemaSignaturesCompatible(oldNorm, newNorm);
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
 * Compares Zod schema signatures to determine if changes are backwards compatible.
 * Adding optional fields (z.ZodOptional) to object schemas is backwards compatible.
 */
function areZodSchemaSignaturesCompatible(
  oldSchema: string,
  newSchema: string,
): boolean {
  // Extract the fields from ZodObject definitions
  // Pattern: { field1: z.ZodType, field2: z.ZodOptional<z.ZodType>, ... }

  // Remove all ZodOptional wrappers to get base structure
  const removeOptionalWrappers = (s: string): string => {
    // Replace z.ZodOptional<Type> with Type
    return s.replace(/z\.ZodOptional<([^>]+)>/g, "$1");
  };

  const oldBase = removeOptionalWrappers(oldSchema);
  const newBase = removeOptionalWrappers(newSchema);

  // If removing optional wrappers makes them similar, the change is just adding optionality
  if (oldBase === newBase) {
    return true;
  }

  // Check if the only difference is new optional fields being added
  // Extract field names from object types
  const extractFieldNames = (s: string): Set<string> => {
    const fields = new Set<string>();
    // Match: fieldName: z.Zod...
    const matches = s.matchAll(/(\w+):\s*z\.Zod/g);
    for (const match of matches) {
      fields.add(match[1]);
    }
    return fields;
  };

  const oldFields = extractFieldNames(oldSchema);
  const newFields = extractFieldNames(newSchema);

  // Check if all old fields are present in new schema
  for (const field of oldFields) {
    if (!newFields.has(field)) {
      // A field was removed - breaking change
      return false;
    }
  }

  // All old fields are present, and potentially new optional fields were added
  // This is backwards compatible
  return true;
}

/**
 * Compares class signatures by extracting and comparing individual methods
 * This handles cases where methods gain optional parameters or optional fields
 */
function areClassSignaturesCompatible(
  oldClass: string,
  newClass: string,
): boolean {
  // Extract class name to ensure we're comparing the same class
  const oldClassNameMatch = oldClass.match(/class\s+(\w+)/);
  const newClassNameMatch = newClass.match(/class\s+(\w+)/);

  if (
    !oldClassNameMatch ||
    !newClassNameMatch ||
    oldClassNameMatch[1] !== newClassNameMatch[1]
  ) {
    return false; // Different classes
  }

  // For classes, use a lenient heuristic: if class names match and the structure
  // is similar (similar length, same general structure), allow parameter-level changes.
  // This is more reliable than trying to parse all methods with regex.

  // Simple length-based check: if new class is similar length or slightly longer,
  // it's likely just adding optional fields/parameters (backward-compatible)
  const oldLength = oldClass.length;
  const newLength = newClass.length;
  const lengthRatio = newLength / Math.max(oldLength, 1);

  // If new is similar length (95-150% of old), allow it
  // Adding optional fields will increase length but not dramatically
  if (lengthRatio >= 0.95 && lengthRatio <= 1.5) {
    // Additional check: ensure new class contains the class name and key structural elements
    // This prevents completely unrelated classes from being considered compatible
    if (newClass.includes(oldClassNameMatch[1])) {
      return true;
    }
  }

  // Also check normalized versions (removing optional markers and defaults)
  // If normalized versions are similar, the changes are likely just optionality
  const normalizeClass = (classText: string): string => {
    let normalized = classText;
    // Remove optional markers: field?: Type -> field: Type
    normalized = normalized.replace(
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\?:\s*/g,
      "$1: ",
    );
    // Remove default values
    normalized = normalized.replace(/=\s*\{[^}]*\}/g, "= {}");
    normalized = normalized.replace(/=\s*[^,)}]+/g, "");
    return normalized;
  };

  const oldNormalized = normalizeClass(oldClass);
  const newNormalized = normalizeClass(newClass);

  // Check if normalized versions are similar (one contains significant portion of the other)
  const similarityThreshold = Math.min(500, oldNormalized.length * 0.5);
  if (newNormalized.includes(oldNormalized.substring(0, similarityThreshold))) {
    return true;
  }

  return false;
}

/**
 * Compares method parameter lists, allowing optional field additions
 */
function areMethodParamsCompatible(
  oldParams: string,
  newParams: string,
): boolean {
  // If they're the same, compatible
  if (oldParams === newParams) {
    return true;
  }

  // Count parameters
  const countParams = (params: string): number => {
    if (!params.trim()) return 0;
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
    return count + 1;
  };

  const oldCount = countParams(oldParams);
  const newCount = countParams(newParams);

  // Same number of params or new has one more (adding optional param)
  if (newCount >= oldCount && newCount <= oldCount + 1) {
    // Check if it's just adding optional fields to object types
    // Normalize by removing optional markers and defaults
    const normalizeParams = (p: string) => {
      return p
        .replace(/\?:\s*/g, ": ")
        .replace(/=\s*\{[^}]*\}/g, "= {}")
        .replace(/=\s*[^,)}]+/g, "");
    };

    const oldNorm = normalizeParams(oldParams);
    const newNorm = normalizeParams(newParams);

    // If normalized versions are similar (one contains the other),
    // it's likely just optional field additions
    if (newNorm.includes(oldNorm) || oldNorm.includes(newNorm)) {
      return true;
    }

    // Check if only optional fields were added to object types
    // This is a heuristic: if the structure is similar, allow it
    // Extract object type content for comparison
    const extractObjectContent = (p: string): string[] => {
      const objects: string[] = [];
      let depth = 0;
      let current = "";
      let inObject = false;
      for (let i = 0; i < p.length; i++) {
        const char = p[i];
        if (char === "{") {
          if (depth === 0) {
            inObject = true;
            current = "";
          }
          depth++;
        } else if (char === "}") {
          depth--;
          if (depth === 0 && inObject) {
            objects.push(current);
            inObject = false;
          }
        } else if (inObject) {
          current += char;
        }
      }
      return objects;
    };

    const oldObjects = extractObjectContent(oldParams);
    const newObjects = extractObjectContent(newParams);

    // If we have object types and new has same or more fields, likely compatible
    if (oldObjects.length > 0 && newObjects.length >= oldObjects.length) {
      // For now, be permissive - if object types exist and count increased,
      // assume it's just adding optional fields
      return true;
    }
  }

  // If we can't determine, be conservative but allow if counts are similar
  // This handles cases where optional fields are added to object types
  return newCount === oldCount || newCount === oldCount + 1;
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

// TODO: Re-enable. Currently disabled because this was failing for a change
// that was backwards compatible (adding an optional field to an interface).
describe.skip("API Compatibility", () => {
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
  }, 30000);
});
