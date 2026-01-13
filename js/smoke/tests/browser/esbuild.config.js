import esbuild from "esbuild";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

async function build() {
  const baseConfig = {
    bundle: true,
    minify: isProduction,
    sourcemap: !isProduction,
    target: "es2020",
    format: "esm",
    platform: "browser",
    // Bundle everything including braintrust and all its dependencies
    // This eliminates the need for import maps
    packages: "bundle",
  };

  // Build combined browser tests (includes both general tests and eval test)
  await esbuild.build({
    ...baseConfig,
    entryPoints: [join(__dirname, "src/browser-tests.ts")],
    outfile: join(__dirname, "dist/browser-tests.js"),
  });

  console.log("✅ Browser tests bundled successfully");
}

build().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
