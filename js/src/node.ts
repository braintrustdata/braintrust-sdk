import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as crypto from "node:crypto";

import iso from "./isomorph";
import { getRepoInfo, getPastNAncestors } from "./gitutil";
import { getCallerLocation } from "./stackutil";
import { _internalSetInitialState } from "./logger";
import { promisify } from "util";
import * as zlib from "zlib";

export function configureNode() {
  iso.getRepoInfo = getRepoInfo;
  iso.getPastNAncestors = getPastNAncestors;
  iso.getEnv = (name) => process.env[name];
  iso.getCallerLocation = getCallerLocation;
  iso.newAsyncLocalStorage = <T>() => new AsyncLocalStorage<T>();
  iso.processOn = (event: string, handler: (code: any) => void) => {
    process.on(event, handler);
  };
  iso.pathJoin = path.join;
  iso.pathDirname = path.dirname;
  iso.mkdir = fs.mkdir;
  iso.writeFile = fs.writeFile;
  iso.readFile = fs.readFile;
  iso.readdir = fs.readdir;
  iso.stat = fs.stat;
  iso.utimes = fs.utimes;
  iso.unlink = fs.unlink;
  iso.homedir = os.homedir;
  iso.gzip = promisify(zlib.gzip);
  iso.gunzip = promisify(zlib.gunzip);
  iso.hash = (data) => crypto.createHash("sha256").update(data).digest("hex");

  _internalSetInitialState();
}
