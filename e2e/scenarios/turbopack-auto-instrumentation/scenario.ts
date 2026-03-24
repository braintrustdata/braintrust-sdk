import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenarioDir = path.dirname(fileURLToPath(import.meta.url));
const MARKER = "orchestrion:openai:chat.completions.create";

function findMarkerInDir(dir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (findMarkerInDir(full)) return true;
    } else if (entry.endsWith(".js")) {
      const content = readFileSync(full, "utf-8");
      if (content.includes(MARKER)) return true;
    }
  }
  return false;
}

// Resolve next CLI relative to the scenario's own node_modules, since the
// scenario runs in a copy of this directory without .bin symlinks.
const nextBin = new URL("./node_modules/next/dist/bin/next", import.meta.url)
  .pathname;

// Run Next.js build (webpack mode with our loader, simulating Turbopack's loader-only constraint)
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: scenarioDir,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});

if (result.status !== 0) {
  throw new Error(`next build failed with exit code ${result.status}`);
}

// Verify instrumentation marker is present in the built output
const nextDir = path.join(scenarioDir, ".next");
if (!findMarkerInDir(nextDir)) {
  throw new Error(
    `Expected to find "${MARKER}" in Next.js build output under ${nextDir}`,
  );
}

console.log(
  `✓ Found instrumentation marker "${MARKER}" in Next.js build output`,
);
