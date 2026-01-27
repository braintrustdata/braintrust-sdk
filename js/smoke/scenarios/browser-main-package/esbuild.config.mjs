import esbuild from "esbuild";
import { rmSync } from "node:fs";

// Clean dist directory
rmSync("dist", { recursive: true, force: true });

// Build browser test bundle
await esbuild.build({
  entryPoints: ["src/browser-message-test.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  external: [], // Bundle everything including braintrust
});

console.log("Build complete!");
