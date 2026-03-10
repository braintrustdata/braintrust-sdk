import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import * as path from "node:path";

export type InstallScenarioDependenciesResult =
  | { status: "no-manifest" }
  | { status: "installed" };

export interface InstallScenarioDependenciesOptions {
  preferOffline?: boolean;
  scenarioDir: string;
}

const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function spawnOrThrow(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? 0}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
}

function findWorkspaceSpecs(
  manifest: Record<string, unknown>,
): Array<{ name: string; section: string; spec: string }> {
  const dependencySections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  return dependencySections.flatMap((section) => {
    const value = manifest[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value).flatMap(([name, spec]) => {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        return [{ name, section, spec }];
      }
      return [];
    });
  });
}

export async function installScenarioDependencies({
  preferOffline = true,
  scenarioDir,
}: InstallScenarioDependenciesOptions): Promise<InstallScenarioDependenciesResult> {
  const manifestPath = path.join(scenarioDir, "package.json");
  if (!(await fileExists(manifestPath))) {
    return { status: "no-manifest" };
  }

  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  const workspaceSpecs = findWorkspaceSpecs(manifest);
  if (workspaceSpecs.length > 0) {
    const details = workspaceSpecs
      .map(({ name, section, spec }) => `${section}.${name} -> ${spec}`)
      .join(", ");
    throw new Error(
      `Scenario package.json in ${scenarioDir} cannot use workspace: dependencies (${details}). Keep workspace packages in e2e/package.json or use a non-workspace spec.`,
    );
  }

  const installArgs = [
    "install",
    "--dir",
    scenarioDir,
    "--ignore-workspace",
    "--no-lockfile",
    "--no-frozen-lockfile",
    "--strict-peer-dependencies=false",
  ];
  if (preferOffline) {
    installArgs.push("--prefer-offline");
  }

  await spawnOrThrow(PNPM_COMMAND, installArgs, scenarioDir);
  return { status: "installed" };
}
