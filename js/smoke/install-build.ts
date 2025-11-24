import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const artifactsDir = path.resolve(process.argv[2] || "../../artifacts");

function findLatestTarball(prefixes: string[]): string | null {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }
  const files = fs
    .readdirSync(artifactsDir)
    .filter((f) => prefixes.some((p) => f.startsWith(p)) && f.endsWith(".tgz"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(artifactsDir, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return files[0]?.f || null;
}

function installTarball(label: string, tarPath: string): void {
  console.log(`Installing ${label} from: ${tarPath}`);
  try {
    execSync(`npm install --legacy-peer-deps --save file:${tarPath}`, {
      stdio: "inherit",
    });
    console.log(`Successfully installed ${path.basename(tarPath)}`);
  } catch (err) {
    console.error(`Failed to install ${label}:`, err.message);
    process.exit(1);
  }
}

// Install braintrust
const braintrustTar = findLatestTarball(["braintrust-"]);
if (!braintrustTar) {
  console.error(`No braintrust tarball found in ${artifactsDir}.`);
  console.error(
    "Build it first: cd js && npm run build && npm pack --pack-destination artifacts",
  );
  process.exit(1);
}
installTarball("braintrust", path.join(artifactsDir, braintrustTar));

// Install @braintrust/otel (only for otel-v1 test)
const cwd = process.cwd();
const isOtelTest = cwd.includes("otel-v1");

if (isOtelTest) {
  const otelTar = findLatestTarball(["@braintrust-otel-", "braintrust-otel-"]);
  if (otelTar) {
    installTarball("@braintrust/otel", path.join(artifactsDir, otelTar));
  } else {
    console.warn(`No @braintrust/otel tarball found in ${artifactsDir}.`);
    console.warn(
      "Build it first: cd integrations/otel-js && npm run build && npm pack --pack-destination ../../../js/artifacts",
    );
  }
}
