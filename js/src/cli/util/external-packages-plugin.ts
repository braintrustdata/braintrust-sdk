import * as esbuild from "esbuild";

// Inspired by https://github.com/evanw/esbuild/issues/619
// In addition to marking node_modules external, explicitly mark
// our packages (braintrust and autoevals) external, in case they're
// installed in a relative path.
export function createMarkKnownPackagesExternalPlugin(
  additionalPackages: string[] = [],
) {
  return {
    name: "make-known-packages-external",
    setup(build: esbuild.PluginBuild) {
      // Mark known packages as external
      const knownPackages = [
        "braintrust",
        "autoevals",
        "@braintrust/",
        "config",
        "lightningcss",
        "@mapbox/node-pre-gyp",
        "fsevents",
        "chokidar",
        ...additionalPackages,
      ];
      const escapedPackages = knownPackages.map((pkg) => {
        const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // For packages ending with /, match anything with that prefix
        if (pkg.endsWith("/")) {
          return escaped + ".*";
        }
        // For regular packages, match exact name or name followed by /
        return escaped + "(?:\\/.*)?";
      });
      const knownPackagesFilter = new RegExp(
        `^(${escapedPackages.join("|")})$`,
      );
      build.onResolve({ filter: knownPackagesFilter }, (args) => ({
        path: args.path,
        external: true,
      }));
    },
  };
}
