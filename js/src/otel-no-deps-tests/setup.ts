// Setup file to restrict module resolution to the isolated workspace directory
// Uses NODE_PATH environment variable to restrict module resolution to ./node_modules
// This prevents Node's require() from resolving modules from parent node_modules

import Module from "module";
import path from "path";

// Get NODE_PATH if set (should be set to ./node_modules in package.json script)
// If not set, use the current working directory's node_modules
const nodePath = process.env.NODE_PATH || path.resolve(process.cwd(), "node_modules");
const allowedPaths = nodePath.split(path.delimiter).map((p) => {
  // Resolve relative paths relative to current working directory
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
});

// Override Module._nodeModulePaths to only search within allowed NODE_PATH directories
// This prevents Node from walking up the directory tree to find modules
// Note: _nodeModulePaths is an internal Node.js API
const originalNodeModulePaths = (Module as any)._nodeModulePaths;
(Module as any)._nodeModulePaths = function (from: string): string[] {
  // Only return paths that are in NODE_PATH (or workspace node_modules)
  return allowedPaths.filter((allowedPath) => {
    // Check if the path exists and is a directory
    try {
      const fs = require("fs");
      return fs.existsSync(allowedPath) && fs.statSync(allowedPath).isDirectory();
    } catch {
      return false;
    }
  });
};

// Also block OpenTelemetry packages explicitly as a fallback
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  // Block any OpenTelemetry package resolution
  if (id.startsWith("@opentelemetry/")) {
    throw new Error(
      `Cannot find module '${id}'. ` +
      "OpenTelemetry packages should not be available in otel-no-deps-tests workspace."
    );
  }
  
  // Call original require for everything else
  return originalRequire.call(this, id);
};

