import {
  GitMetadataSettings as GitMetadataSettingsSchema,
  type GitMetadataSettingsType as GitMetadataSettings,
  RepoInfo as RepoInfoSchema,
  type RepoInfoType as RepoInfo,
} from "./generated_types";

export interface CallerLocation {
  caller_functionname: string;
  caller_filename: string;
  caller_lineno: number;
}

export interface IsoAsyncLocalStorage<T> {
  enterWith(store: T): void;
  run<R>(store: T | undefined, callback: () => R): R;
  getStore(): T | undefined;
}

class DefaultAsyncLocalStorage<T> implements IsoAsyncLocalStorage<T> {
  constructor() {}

  enterWith(_: T): void {}
  run<R>(_: T | undefined, callback: () => R): R {
    return callback();
  }
  getStore(): T | undefined {
    return undefined;
  }
}

export interface Common {
  getRepoInfo: (
    settings?: GitMetadataSettings,
  ) => Promise<RepoInfo | undefined>;
  getPastNAncestors: (n?: number, remote?: string) => Promise<string[]>;
  getEnv: (name: string) => string | undefined;
  getCallerLocation: () => CallerLocation | undefined;
  newAsyncLocalStorage: <T>() => IsoAsyncLocalStorage<T>;
  processOn: (event: string, handler: (code: any) => void) => void;

  // hash a string. not guaranteed to be crypto safe.
  hash?: (data: string) => string;

  // Cross-platform utilities.
  basename: (filepath: string) => string;
  writeln: (text: string) => void;

  // Filesystem operations.
  pathJoin?: (...args: string[]) => string;
  pathDirname?: (path: string) => string;
  mkdir?: (
    path: string,
    opts?: { recursive?: boolean },
  ) => Promise<string | undefined>;
  writeFile?: (filename: string, data: string) => Promise<void>;
  readFile?: (filename: string) => Promise<Uint8Array>;
  readdir?: (path: string) => Promise<string[]>;
  utimes?: (path: string, atime: Date, mtime: Date) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  stat?: (path: string) => Promise<any>; // type-erased
  statSync?: (path: string) => any; // type-erased
  homedir?: () => string;

  // zlib (promisified and type-erased).
  gunzip?: (data: any) => Promise<any>;
  gzip?: (data: any) => Promise<any>;

  // Nunjucks template rendering (lints if strict is true)
  renderNunjucksString: (
    template: string,
    variables: Record<string, unknown>,
    options?: { strict?: boolean },
  ) => string;
}

const iso: Common = {
  getRepoInfo: async (_settings) => undefined,
  getPastNAncestors: async () => [],
  getEnv: (_name) => undefined,
  getCallerLocation: () => undefined,
  newAsyncLocalStorage: <T>() => new DefaultAsyncLocalStorage<T>(),
  processOn: (_0, _1) => {},
  renderNunjucksString: () => {
    throw new Error(
      "Nunjucks templating is not supported in this build. Use templateFormat: 'mustache' (or omit templateFormat).",
    );
  },
  basename: (filepath: string) => filepath.split(/[\\/]/).pop() || filepath,
  writeln: (text: string) => console.log(text),
};
export default iso;
