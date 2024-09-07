export interface AuthArgs {
  api_key?: string;
  org_name?: string;
  app_url?: string;
  env_file?: string;
}

export interface CompileArgs {
  watch: boolean;
  tsconfig?: string;
}

export interface RunArgs extends AuthArgs, CompileArgs {
  files: string[];
  list: boolean;
  jsonl: boolean;
  verbose: boolean;
  filter?: string[];
  no_send_logs: boolean;
  no_progress_bars: boolean;
  terminate_on_failure: boolean;
  bundle: boolean;
  set_current: boolean;
}

export interface BundleArgs extends AuthArgs, CompileArgs {
  files: string[];
}
