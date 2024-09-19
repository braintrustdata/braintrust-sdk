import { loadEnvConfig } from "@next/env";
import * as dotenv from "dotenv";
import { BundleArgs } from "./types";
import { error } from "../framework";
import { BtBuildResult, handleBuildFailure, initializeHandles } from "../cli";
import { login } from "../logger";
import { uploadHandleBundles } from "../functions/upload";

export async function bundleCommand(args: BundleArgs) {
  // Load the environment variables from the .env files using the same rules as Next.js
  loadEnvConfig(process.cwd(), true);

  if (args.env_file) {
    // Load via dotenv library
    const loaded = dotenv.config({ path: args.env_file });
    if (loaded.error) {
      console.error(error(`Error loading ${args.env_file}: ${loaded.error}`));
      process.exit(1);
    }
  }

  const handles = await initializeHandles({
    mode: "bundle",
    files: args.files,
    tsconfig: args.tsconfig,
  });

  await login({
    apiKey: args.api_key,
    orgName: args.org_name,
    appUrl: args.app_url,
  });

  try {
    const allBuildResultsP: Promise<BtBuildResult>[] = Object.values(
      handles,
    ).map((handle) => handle.rebuild());

    const bundlePromises = Object.fromEntries(
      Object.entries(handles).map(([inFile, handle]) => [
        inFile,
        handle.bundle(),
      ]),
    );

    const allBuildResults = await Promise.all(allBuildResultsP);
    const buildResults = [];
    for (const buildResult of allBuildResults) {
      if (buildResult.type === "failure") {
        handleBuildFailure({
          result: buildResult,
          terminateOnFailure: args.terminate_on_failure,
          verbose: args.verbose,
        });
      } else {
        buildResults.push(buildResult);
      }
    }

    const { numFailed } = await uploadHandleBundles({
      buildResults,
      bundlePromises,
      handles,
      setCurrent: true,
      verbose: args.verbose,
    });

    if (numFailed > 0) {
      process.exit(1);
    }
  } finally {
    for (const handle of Object.values(handles)) {
      await handle.destroy();
    }
  }
}
