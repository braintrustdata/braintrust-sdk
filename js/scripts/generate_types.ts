import { fileURLToPath } from "node:url";
import {
  generateZodClientFromOpenAPI,
  getHandlebars,
} from "openapi-zod-client";
import * as fs from "fs/promises";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_SPEC_PATH = path.join(SCRIPT_DIR, "../../generated_types.json");
const TEMPLATE_PATH = path.join(
  SCRIPT_DIR,
  "./openapi_zod_client_output_template.hbs",
);
const OUTPUT_PATH = path.join(SCRIPT_DIR, "../src/generated_types.ts");

async function main() {
  const zodVersion = process.env.ZOD_VERSION || "3";
  const openApiDoc = JSON.parse(await fs.readFile(OPENAPI_SPEC_PATH, "utf-8"));
  const handlebars = getHandlebars();

  await generateZodClientFromOpenAPI({
    openApiDoc,
    templatePath: TEMPLATE_PATH,
    distPath: OUTPUT_PATH,
    handlebars,
    options: {
      shouldExportAllSchemas: true,
      shouldExportAllTypes: true,
      additionalPropertiesDefaultValue: false,
    },
  });

  let code = await fs.readFile(OUTPUT_PATH, "utf8");
  if (zodVersion.startsWith("4")) {
    // Patch all z.record(value) to z.record(z.string(), value) for Zod 4
    code = code.replace(
      /z\.record\s*\(\s*([^)\n]+?)\s*\)/g,
      "z.record(z.string(), $1)",
    );

    // Patch all z.enum([...]) to z.enum([... as const]) for Zod 4
    code = code.replace(/z\.enum\((\[[^\]]*\])\)/g, "z.enum($1 as const)");
  }
  const internalGitSha = openApiDoc.info["x-internal-git-sha"] || "UNKNOWN";
  const banner = `// Auto-generated file (internal git SHA ${internalGitSha}) -- do not modify\n\n`;
  await fs.writeFile(OUTPUT_PATH, banner + code);
}

main();
