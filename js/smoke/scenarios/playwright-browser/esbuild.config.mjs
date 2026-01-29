import esbuild from "esbuild";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function build() {
  const baseConfig = {
    bundle: true,
    minify: true,
    target: "es2020",
    format: "esm",
    platform: "browser",
    packages: "bundle",
  };

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
