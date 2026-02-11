/**
 * Retrieves the version of a package from its package.json file.
 * If the package.json file cannot be read, it defaults to the Node.js version.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageVersions = new Map<string, string>();

export function getPackageVersion(baseDir: string): string {
  if (packageVersions.has(baseDir)) {
    return packageVersions.get(baseDir)!;
  }

  try {
    const packageJsonPath = join(baseDir, "package.json");
    const jsonFile = readFileSync(packageJsonPath, "utf8");
    const { version } = JSON.parse(jsonFile);
    packageVersions.set(baseDir, version);
    return version;
  } catch {
    return process.version.slice(1);
  }
}
