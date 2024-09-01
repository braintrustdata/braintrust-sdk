import nodeModulesPaths from "../jest/nodeModulesPaths";
import path, { dirname } from "path";
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
      evaluators: {},
      reporters: {},
    };
    globalThis._lazy_load = true;
    globalThis.__inherited_braintrust_state = _internalGetGlobalState();
    const __filename = inFile;
    const __dirname = dirname(__filename);
    new Function("require", "__filename", "__dirname", moduleText)(
      require,
      __filename,
      __dirname,
    );
    return { ...globalThis._evals };
  });
}
