import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  webpack(config) {
    // Use only the webpack-loader (not the plugin) to verify
    // compatibility with Turbopack, which only supports loaders.
    config.module.rules.unshift({
      use: [{ loader: require.resolve("braintrust/webpack-loader") }],
    });
    return config;
  },
};

export default nextConfig;
