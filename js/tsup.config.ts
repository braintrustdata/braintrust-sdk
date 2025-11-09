import { defineConfig, type Options } from "tsup";

const esmNodeSupportBanner = {
  js: `import { fileURLToPath } from 'url';
import { createRequire as topLevelCreateRequire } from 'module';
import _nPath from 'path'
const require = topLevelCreateRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = _nPath.dirname(__filename);`,
};

export default defineConfig((options: Options) => {
  const isEsm = options.format === "esm";
  const banner = isEsm ? esmNodeSupportBanner : undefined;
  return [
    {
      entry: ["src/index.ts"],
      format: ["cjs", "esm"],
      outDir: "dist",
      external: ["zod"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner,
      splitting: true,
      clean: true,
    },
    {
      entry: ["src/browser.ts"],
      format: ["cjs", "esm"],
      outDir: "dist",
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner,
      splitting: true,
      clean: false,
    },
    {
      entry: ["src/cli.ts"],
      format: ["cjs"],
      outDir: "dist",
      external: ["esbuild", "prettier", "typescript"],
      // CLI doesn't need DTS
      dts: false,
      clean: false,
    },
    {
      entry: ["dev/index.ts"],
      format: ["cjs", "esm"],
      outDir: "dev/dist",
      external: ["esbuild", "prettier", "typescript"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner,
      splitting: true,
      clean: true,
    },
    {
      entry: ["util/index.ts"],
      format: ["cjs", "esm"],
      outDir: "util/dist",
      external: ["esbuild", "prettier", "typescript"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner,
      splitting: true,
      clean: true,
    },
  ];
});
