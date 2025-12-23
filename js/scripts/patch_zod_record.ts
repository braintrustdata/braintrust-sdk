import { Project, SyntaxKind } from "ts-morph";
import * as path from "path";

export function patchZodRecord(filePath: string) {
  const project = new Project({
    tsConfigFilePath: path.join(__dirname, "../tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(filePath);

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression);
      const expr = call.getExpression();
      // Check for z.record(...) in any context (chained, nested, etc)
      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = expr;
        const name = propAccess.getName && propAccess.getName();
        const exprExpr = propAccess.getExpression && propAccess.getExpression();
        if (name === "record" && exprExpr && exprExpr.getText() === "z") {
          const args = call.getArguments();
          if (args.length === 1) {
            // Only patch single-argument z.record
            call.insertArgument(0, "z.string()");
          }
        }
      }
    }
  });

  sourceFile.saveSync();
}

// Allow CLI usage for backwards compatibility
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx patch_zod_record.ts <file>");
    process.exit(1);
  }
  patchZodRecord(filePath);
}
