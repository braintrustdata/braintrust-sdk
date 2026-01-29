import esbuild from "esbuild";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await esbuild.build({
  entryPoints: ["src/browser-message-test.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  mainFields: ["browser", "module", "main"],
  external: [],
});

console.log("Build complete!");
