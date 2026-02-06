import { type IfExistsType as IfExists } from "../../generated_types";

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
  external_packages?: string[];
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
  dev: boolean;
  dev_host: string;
  dev_port: number;
  dev_org_name?: string;
  runner?: string;
}

export interface BundleArgs extends CommonArgs, AuthArgs, CompileArgs {
  files: string[];
  if_exists: IfExists;
}

export interface PullArgs extends CommonArgs, AuthArgs {
  output_dir: string;
  project_name?: string;
  project_id?: string;
  id?: string;
  slug?: string;
  version?: string;
  force: boolean;
}
