import { defineConfig } from "tsup";
import path from "node:path";
import fs from "node:fs";
import { builtinModules } from "node:module";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["zod"],
    removeNodeProtocol: false,
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
  {
    entry: ["src/browser.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    removeNodeProtocol: false,
    external: ["zod", "nunjucks"],
    esbuildPlugins: [
      {
        name: "browser-stubs",
        setup(build) {
          const resolveTo = (p: string) => ({
            path: p,
            namespace: "file",
          });

          build.onResolve({ filter: /^\.\/template\/nunjucks-env$/ }, () =>
            resolveTo(
              path.join(process.cwd(), "src/template/nunjucks-env.browser.ts"),
            ),
          );
          build.onResolve({ filter: /^\.\/template\/nunjucks-utils$/ }, () =>
            resolveTo(
              path.join(
                process.cwd(),
                "src/template/nunjucks-utils.browser.ts",
              ),
            ),
          );

          build.onResolve({ filter: /^\.\/nunjucks-env$/ }, (args) =>
            resolveTo(
              path.join(path.dirname(args.importer), "nunjucks-env.browser.ts"),
            ),
          );
          build.onResolve({ filter: /^\.\/nunjucks-utils$/ }, (args) =>
            resolveTo(
              path.join(
                path.dirname(args.importer),
                "nunjucks-utils.browser.ts",
              ),
            ),
          );
        },
      },
    ],
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: false,
  },
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["cjs"],
    removeNodeProtocol: false,
    outDir: "dist",
    external: ["esbuild", "prettier", "typescript", "zod"],
    // CLI doesn't need DTS
    dts: false,
    clean: false,
  },
  {
    entry: ["dev/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dev/dist",
    removeNodeProtocol: false,
    external: ["esbuild", "prettier", "typescript", "zod"],
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
  {
    entry: ["util/index.ts"],
    format: ["cjs", "esm"],
    outDir: "util/dist",
    external: ["esbuild", "prettier", "typescript", "zod"],
    removeNodeProtocol: false,
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
]);
