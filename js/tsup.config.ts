import { defineConfig } from "tsup";
import path from "path";

const createNunjucksPlugin = (variant: "cjs" | "esm") => ({
  name: `nunjucks-${variant}`,
  setup(build: any) {
    build.onResolve({ filter: /_platform-nunjucks$/ }, (args: any) => {
      const resolvedPath = path.resolve(
        args.resolveDir,
        `./_platform-nunjucks-${variant}.ts`,
      );
      return { path: resolvedPath };
    });
  },
});

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    outDir: "dist",
    external: ["zod"],
    noExternal: ["nunjucks"],
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    esbuildPlugins: [createNunjucksPlugin("cjs")],
    splitting: true,
    clean: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    external: ["zod", "nunjucks"],
    dts: false,
    esbuildPlugins: [createNunjucksPlugin("esm")],
    splitting: true,
    clean: false,
  },
  {
    entry: ["src/browser.ts"],
    format: ["cjs"],
    outDir: "dist",
    external: ["nunjucks"],
    noExternal: [],
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    esbuildPlugins: [createNunjucksPlugin("cjs")],
    splitting: true,
    clean: false,
  },
  {
    entry: ["src/browser.ts"],
    format: ["esm"],
    outDir: "dist",
    external: ["nunjucks"],
    dts: false,
    esbuildPlugins: [createNunjucksPlugin("esm")],
    splitting: true,
    clean: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["cjs"],
    outDir: "dist",
    external: ["esbuild", "prettier", "typescript"],
    noExternal: ["nunjucks"],
    dts: false,
    esbuildPlugins: [createNunjucksPlugin("cjs")],
    clean: false,
  },
  {
    entry: ["dev/index.ts"],
    format: ["cjs"],
    outDir: "dev/dist",
    external: ["esbuild", "prettier", "typescript"],
    noExternal: ["nunjucks"],
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    esbuildPlugins: [createNunjucksPlugin("cjs")],
    splitting: true,
    clean: true,
  },
  {
    entry: ["dev/index.ts"],
    format: ["esm"],
    outDir: "dev/dist",
    external: ["esbuild", "prettier", "typescript", "nunjucks"],
    dts: false,
    esbuildPlugins: [createNunjucksPlugin("esm")],
    splitting: true,
    clean: false,
  },
  {
    entry: ["util/index.ts"],
    format: ["cjs"],
    outDir: "util/dist",
    external: ["esbuild", "prettier", "typescript"],
    noExternal: ["nunjucks"],
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    esbuildPlugins: [createNunjucksPlugin("cjs")],
    splitting: true,
    clean: true,
  },
  {
    entry: ["util/index.ts"],
    format: ["esm"],
    outDir: "util/dist",
    external: ["esbuild", "prettier", "typescript", "nunjucks"],
    dts: false,
    esbuildPlugins: [createNunjucksPlugin("esm")],
    splitting: true,
    clean: false,
  },
]);
