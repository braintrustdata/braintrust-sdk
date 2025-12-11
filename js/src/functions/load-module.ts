import nodeModulesPaths from "../jest/nodeModulesPaths";
import path, { dirname } from "path";
import { pathToFileURL } from "url";
import { _internalGetGlobalState } from "../logger";
import { EvaluatorFile } from "../framework";

function evalWithModuleContext<T>(inFile: string, evalFn: () => T): T {
  const modulePaths = [...module.paths];
  try {
    module.paths = nodeModulesPaths(path.dirname(inFile), {});
    return evalFn();
  } finally {
    module.paths = modulePaths;
  }
}

export function loadModule({
  inFile,
  moduleText,
}: {
  inFile: string;
  moduleText: string;
}): EvaluatorFile {
  return evalWithModuleContext(inFile, () => {
    globalThis._evals = {
      functions: [],
      prompts: [],
      evaluators: {},
      reporters: {},
    };
    globalThis._lazy_load = true;
    globalThis.__inherited_braintrust_state = _internalGetGlobalState();
    const __filename = inFile;
    const __dirname = dirname(__filename);
    new Function("require", "module", "__filename", "__dirname", moduleText)(
      require,
      module,
      __filename,
      __dirname,
    );
    return { ...globalThis._evals };
  });
}

// Use dynamic import to execute ESM output (e.g., for top-level await)
// while keeping the caller in CJS. This avoids TypeScript downleveling of `import()`.
async function dynamicImport(specifier: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const importer = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<unknown>;
  return await importer(specifier);
}

export async function loadModuleEsmFromFile({
  inFile,
  modulePath,
}: {
  inFile: string;
  modulePath: string;
}): Promise<EvaluatorFile> {
  return await evalWithModuleContext(inFile, async () => {
    globalThis._evals = {
      functions: [],
      prompts: [],
      evaluators: {},
      reporters: {},
    };
    globalThis._lazy_load = true;
    globalThis.__inherited_braintrust_state = _internalGetGlobalState();

    const url = pathToFileURL(modulePath).href;
    await dynamicImport(url);
    return { ...globalThis._evals };
  });
}
