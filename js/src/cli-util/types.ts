export interface CommonArgs {
  verbose: boolean;
}

export interface AuthArgs {
  api_key?: string;
  org_name?: string;
  app_url?: string;
  env_file?: string;
}

export interface CompileArgs {
  tsconfig?: string;
  terminate_on_failure: boolean;
}

export interface RunArgs extends CommonArgs, AuthArgs, CompileArgs {
  files: string[];
  watch: boolean;
  list: boolean;
  jsonl: boolean;
  filter?: string[];
  no_send_logs: boolean;
  no_progress_bars: boolean;
  bundle: boolean;
  push: boolean;
}

export interface BundleArgs extends CommonArgs, AuthArgs, CompileArgs {
  files: string[];
}