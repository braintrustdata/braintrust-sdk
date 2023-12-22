import * as path from "path";

import { CallerLocation } from "./isomorph";

export interface StackTraceEntry {
  functionName: string;
  fileName: string;
  lineNo: number;
}

export function getStackTrace(): StackTraceEntry[] {
  const trace = new Error().stack;
  if (trace === undefined) {
    return [];
  }
  const traceLines = trace.split("\n");
  const out: StackTraceEntry[] = [];
  const stackFrameRegex = /at(.*)\((.*):(\d+):(\d+)\)/;
  for (const traceLine of traceLines.slice(1)) {
    const matches = traceLine.match(stackFrameRegex);
    if (matches === null || matches.length !== 5) {
      continue;
    }
    const entry: StackTraceEntry = {
      functionName: matches[1].trim(),
      fileName: matches[2],
      lineNo: parseInt(matches[3]),
    };
    if (!isNaN(entry.lineNo)) {
      out.push(entry);
    }
  }
  return out;
}

// Emulates the Path.parents approach in sdk/py/src/braintrust/util.py by
// iterating over the parents of `path`, and checking if `directory`
// matches any of them.
function isSubpath(testPath: string, directory: string) {
  testPath = path.normalize(testPath);
  directory = path.normalize(directory);
  if (testPath === directory) {
    return true;
  }
  const maxIters = testPath.split(path.sep).length + 1;
  for (let i = 0; i < maxIters; ++i) {
    const parentDir = path.dirname(testPath);
    if (parentDir === directory) {
      return true;
    }
  }
  return false;
}

// Fetches the first StackTraceEntry not contained inside the same directory as
// this file (or any of its subdirectories) and converts it into a CallerLocation.
export function getCallerLocation(): CallerLocation | undefined {
  let thisDir: string | undefined = undefined;
  const entries = getStackTrace();
  for (const frame of entries) {
    if (thisDir === undefined) {
      thisDir = path.dirname(frame.fileName);
    }
    if (!isSubpath(frame.fileName, thisDir)) {
      return {
        caller_functionname: frame.functionName,
        caller_filename: frame.fileName,
        caller_lineno: frame.lineNo,
      };
    }
  }
  return undefined;
}
