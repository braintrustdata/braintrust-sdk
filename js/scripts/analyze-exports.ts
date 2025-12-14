import { Project, Node, SyntaxKind } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// Map from package.json exports to their .d.ts files
// Note: CLI is excluded since it's a binary (npx braintrust), not a library import
const entryPoints: Record<string, string> = {
  "dist/index.ts": "dist/index.d.ts",
  "dist/browser.ts": "dist/browser.d.ts",
  "dev/dist/index.ts": "dev/dist/index.d.ts",
  "util/dist/index.ts": "util/dist/index.d.ts",
};

interface ExportInfo {
  types: string[];
  objects: string[];
}

function analyzeDeclarationFile(dtsPath: string): ExportInfo {
  const result: ExportInfo = { types: [], objects: [] };

  if (!fs.existsSync(dtsPath)) {
    console.error(`Declaration file not found: ${dtsPath}`);
    return result;
  }

  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(dtsPath);
  const exports = sourceFile.getExportedDeclarations();

  for (const [name, declarations] of exports) {
    // Skip default exports or handle separately
    if (name === "default") {
      result.objects.push("default");
      continue;
    }

    // Determine if this export is a type or a value
    let isType = false;

    for (const declaration of declarations) {
      const kind = declaration.getKind();

      // These are always types
      if (
        kind === SyntaxKind.InterfaceDeclaration ||
        kind === SyntaxKind.TypeAliasDeclaration ||
        kind === SyntaxKind.TypeParameter
      ) {
        isType = true;
        break;
      }

      // Check if the export is explicitly marked as type-only
      if (Node.isExportSpecifier(declaration)) {
        if (declaration.isTypeOnly()) {
          isType = true;
          break;
        }
      }

      // Check parent export declaration for type-only
      const parent = declaration.getParent();
      if (Node.isExportDeclaration(parent)) {
        if (parent.isTypeOnly()) {
          isType = true;
          break;
        }
      }
    }

    if (isType) {
      result.types.push(name);
    } else {
      result.objects.push(name);
    }
  }

  return result;
}

function main() {
  const rootDir = process.cwd();
  const results: Record<string, ExportInfo> = {};

  for (const [outputPath, dtsPath] of Object.entries(entryPoints)) {
    const fullPath = path.resolve(rootDir, dtsPath);
    const exports = analyzeDeclarationFile(fullPath);

    // Remove duplicates and sort
    exports.types = [...new Set(exports.types)].sort();
    exports.objects = [...new Set(exports.objects)].sort();

    results[outputPath] = exports;
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
