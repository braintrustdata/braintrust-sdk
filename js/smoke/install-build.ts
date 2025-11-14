import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const artifactsDir = path.resolve(process.argv[2] || "../../artifacts");
const files = fs
  .readdirSync(artifactsDir)
  .filter((f) => f.startsWith("braintrust-") && f.endsWith(".tgz"))
  .map((f) => ({ f, mtime: fs.statSync(path.join(artifactsDir, f)).mtime }))
  .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

const tarFile = files[0]?.f;

if (!tarFile) {
  console.error("No braintrust build found in artifacts directory.");
  process.exit(1);
}

const tarPath = path.join(artifactsDir, tarFile);

console.log(`Installing local build from: ${tarPath}`);

try {
  execSync(`npm install file:${tarPath}`, { stdio: "inherit" });
  console.log(`Successfully installed ${tarFile}`);
} catch (err) {
  console.error("Failed to install tarball:", err.message);
  process.exit(1);
}
