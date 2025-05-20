import { GitMetadataSettings, RepoInfo } from "@braintrust/core/typespecs";

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
  getPastNAncestors: () => Promise<string[]>;
  getEnv: (name: string) => string | undefined;
  getCallerLocation: () => CallerLocation | undefined;
  newAsyncLocalStorage: <T>() => IsoAsyncLocalStorage<T>;
  processOn: (event: string, handler: (code: any) => void) => void;

  // hash a string. not guaranteed to be crypto safe.
  hash?: (data: string) => string;

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
  homedir?: () => string;

  // zlib (promisified and type-erased).
  gunzip?: (data: any) => Promise<any>;
  gzip?: (data: any) => Promise<any>;
}

const iso: Common = {
  getRepoInfo: async (_settings) => undefined,
  getPastNAncestors: async () => [],
  getEnv: (_name) => undefined,
  getCallerLocation: () => undefined,
  newAsyncLocalStorage: <T>() => new DefaultAsyncLocalStorage<T>(),
  processOn: (_0, _1) => {},
};
export default iso;
