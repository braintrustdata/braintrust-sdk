export interface RepoStatus {
  commit?: string;
  branch?: string;
  tag?: string;
  dirty: boolean;
  author_name?: string;
  author_email?: string;
  commit_message?: string;
  commit_time?: string;
}

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
  getRepoStatus: () => Promise<RepoStatus | undefined>;
  getPastNAncestors: () => Promise<string[]>;
  getEnv: (name: string) => string | undefined;
  getCallerLocation: () => CallerLocation | undefined;
  newAsyncLocalStorage: <T>() => IsoAsyncLocalStorage<T>;
  processOn: (event: string, handler: (code: any) => void) => void;
}

const iso: Common = {
  getRepoStatus: async () => undefined,
  getPastNAncestors: async () => [],
  getEnv: (_name) => undefined,
  getCallerLocation: () => undefined,
  newAsyncLocalStorage: <T>() => new DefaultAsyncLocalStorage<T>(),
  processOn: (_0, _1) => {},
};
export default iso;
