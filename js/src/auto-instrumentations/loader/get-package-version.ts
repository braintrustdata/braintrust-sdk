/**
 * Retrieves the version of a package from its package.json file.
 * If the package.json file cannot be read, it defaults to the Node.js version.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageVersions = new Map<string, string>();
const packageNames = new Map<string, string>();

function readPackageJson(baseDir: string): Record<string, unknown> | undefined {
  try {
    const packageJsonPath = join(baseDir, "package.json");
    const jsonFile = readFileSync(packageJsonPath, "utf8");
    return JSON.parse(jsonFile) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function getPackageVersion(baseDir: string): string {
  if (packageVersions.has(baseDir)) {
    return packageVersions.get(baseDir)!;
  }

  const packageJson = readPackageJson(baseDir);
  if (typeof packageJson?.version === "string") {
    packageVersions.set(baseDir, packageJson.version);
    return packageJson.version;
  }

  return process.version.slice(1);
}

export function getPackageName(baseDir: string): string | undefined {
  if (packageNames.has(baseDir)) {
    return packageNames.get(baseDir);
  }

  const packageJson = readPackageJson(baseDir);
  if (typeof packageJson?.name === "string") {
    packageNames.set(baseDir, packageJson.name);
    return packageJson.name;
  }

  return undefined;
}
