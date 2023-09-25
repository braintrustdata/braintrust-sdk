import * as os from "os";
import * as path from "path";

export const CACHE_PATH = path.join(os.homedir(), ".cache", "braintrust");
export const EXPERIMENTS_PATH = path.join(CACHE_PATH, "experiments");
export const LOGIN_INFO_PATH = path.join(CACHE_PATH, "api_info.json");
