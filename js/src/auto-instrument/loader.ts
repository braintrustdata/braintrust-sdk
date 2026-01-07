import { Hook } from "import-in-the-middle";
import type { Config } from "./config";
import { log } from "./util";
import { wrapOpenAI } from "./detectors/openai";

type WrapperFunction = (exports: any, config: Config) => any;

const SDK_MAP: Record<string, WrapperFunction> = {
  openai: wrapOpenAI,
};

export function registerHooks(config: Config): void {
  const allSDKs = Object.keys(SDK_MAP);

  let targetSDKs: string[];
  if (config.include.length > 0) {
    targetSDKs = config.include.filter((sdk) => allSDKs.includes(sdk));
    if (targetSDKs.length < config.include.length) {
      const unknown = config.include.filter((sdk) => !allSDKs.includes(sdk));
      log(
        config,
        "warn",
        `Unknown SDKs in include list (will be ignored): ${unknown.join(", ")}`,
      );
    }
  } else {
    targetSDKs = allSDKs;
  }

  targetSDKs = targetSDKs.filter((sdk) => !config.exclude.includes(sdk));

  if (targetSDKs.length === 0) {
    log(config, "info", "No SDKs to instrument (after filtering)");
    return;
  }

  log(config, "info", `Installing hooks for: ${targetSDKs.join(", ")}`);

  new Hook(
    targetSDKs,
    (exports: any, name: string, basedir: string | void): any => {
      try {
        log(
          config,
          "info",
          `Intercepted import of ${name} from ${basedir || "unknown"}`,
        );

        const wrapper = SDK_MAP[name];
        if (wrapper) {
          return wrapper(exports, config);
        }
      } catch (error) {
        log(
          config,
          "warn",
          `Failed to wrap ${name}:`,
          error instanceof Error ? error.message : String(error),
        );

        if (config.debug && error instanceof Error) {
          console.error(error.stack);
        }
      }

      return exports;
    },
  );

  log(config, "info", "Hooks registered successfully");
}
