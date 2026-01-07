export interface Config {
  enabled: boolean;
  include: string[];
  exclude: string[];
  debug: boolean;
}

export function loadConfig(override?: Partial<Config>): Config {
  const envConfig: Partial<Config> = {};

  if (process.env.BRAINTRUST_AUTO_INSTRUMENT !== undefined) {
    envConfig.enabled = process.env.BRAINTRUST_AUTO_INSTRUMENT === "1";
  }

  if (process.env.BRAINTRUST_AUTO_INSTRUMENT_INCLUDE) {
    envConfig.include = process.env.BRAINTRUST_AUTO_INSTRUMENT_INCLUDE.split(
      ",",
    ).map((s) => s.trim());
  }

  if (process.env.BRAINTRUST_AUTO_INSTRUMENT_EXCLUDE) {
    envConfig.exclude = process.env.BRAINTRUST_AUTO_INSTRUMENT_EXCLUDE.split(
      ",",
    ).map((s) => s.trim());
  }

  if (process.env.BRAINTRUST_AUTO_INSTRUMENT_DEBUG !== undefined) {
    envConfig.debug = process.env.BRAINTRUST_AUTO_INSTRUMENT_DEBUG === "1";
  }

  return {
    enabled: true,
    include: [],
    exclude: [],
    debug: false,
    ...envConfig,
    ...override,
  };
}
