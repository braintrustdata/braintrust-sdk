import { FullConfig } from "@playwright/test";
import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function globalSetup(config: FullConfig) {
  void config;

  // Ensure the shared smoke-test package is built so browser bundle picks up latest exports.
  const sharedDir = join(__dirname, "..", "..", "shared");
  console.log("🔨 Building shared smoke-test package...");
  execSync("npm run build", {
    cwd: sharedDir,
    stdio: "inherit",
  });

  console.log("🔨 Building browser tests...");
  try {
    execSync("node esbuild.config.js", {
      cwd: __dirname,
      stdio: "inherit",
    });
    console.log("✅ Build completed");
  } catch (error) {
    console.error("❌ Build failed");
    throw error;
  }
}

export default globalSetup;
