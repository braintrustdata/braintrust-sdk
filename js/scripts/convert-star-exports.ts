import { Project, SyntaxKind, Node } from "ts-morph";
import * as path from "path";

/**
 * Script to convert `export *` statements to explicit exports
 *
 * Usage: npx tsx scripts/convert-star-exports.ts <file-path>
 * Example: npx tsx scripts/convert-star-exports.ts src/exports-common.ts
 */

function convertStarExports(filePath: string) {
  const project = new Project({
    tsConfigFilePath: path.resolve(process.cwd(), "tsconfig.json"),
  });

  const sourceFile = project.addSourceFileAtPath(filePath);
  const exportDeclarations = sourceFile.getExportDeclarations();

  for (const exportDecl of exportDeclarations) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) {
      continue;
    }

    // Skip if it has named exports (export { a, b })
    if (exportDecl.getNamedExports().length > 0) {
      console.log(`  Skipping: has named exports`);
      continue;
    }

    // Check if it's a namespace export with a name binding (export * as name)
    const namespaceExport = exportDecl.getNamespaceExport();
    if (namespaceExport) {
      console.log(
        `  Skipping: namespace export (export * as ${namespaceExport.getText()})`,
      );
      continue;
    }

    // This is a bare export * statement - process it
    console.log(`Processing: export * from "${moduleSpecifier}"`);

    // Resolve the module
    const moduleSymbol = exportDecl.getModuleSpecifierSourceFile();
    if (!moduleSymbol) {
      console.warn(`  Warning: Could not resolve module "${moduleSpecifier}"`);
      continue;
    }

    // Get all exports from the target module
    const exports = moduleSymbol.getExportedDeclarations();
    const typeExports: string[] = [];
    const valueExports: string[] = [];

    for (const [name, declarations] of exports) {
      if (name === "default") continue;

      // Determine if it's a type or value
      let isType = false;
      for (const declaration of declarations) {
        const kind = declaration.getKind();
        if (
          kind === SyntaxKind.InterfaceDeclaration ||
          kind === SyntaxKind.TypeAliasDeclaration ||
          kind === SyntaxKind.TypeParameter
        ) {
          isType = true;
          break;
        }
      }

      if (isType) {
        typeExports.push(name);
      } else {
        valueExports.push(name);
      }
    }

    // Build the new export statement
    const parts: string[] = [];

    if (typeExports.length > 0) {
      typeExports.sort();
      const typeList = typeExports.join(", ");
      parts.push(`export type { ${typeList} } from "${moduleSpecifier}";`);
    }

    if (valueExports.length > 0) {
      valueExports.sort();
      const valueList = valueExports.join(", ");
      parts.push(`export { ${valueList} } from "${moduleSpecifier}";`);
    }

    if (parts.length === 0) {
      console.log(`  No exports found, removing statement`);
      exportDecl.remove();
    } else {
      console.log(
        `  Found ${typeExports.length} types, ${valueExports.length} values`,
      );
      exportDecl.replaceWithText(parts.join("\n"));
    }
  }

  // Save the file
  sourceFile.saveSync();
  console.log(`\nFile updated: ${filePath}`);
}

function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: npx tsx scripts/convert-star-exports.ts <file-path>");
    console.error(
      "Example: npx tsx scripts/convert-star-exports.ts src/exports-common.ts",
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  console.log(`Converting star exports in: ${resolvedPath}\n`);

  convertStarExports(resolvedPath);
}

main();
