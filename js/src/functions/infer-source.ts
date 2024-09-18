import { MappingItem, SourceMapConsumer } from "source-map";
import * as fs from "fs/promises";
import { EvaluatorFile, warning } from "../framework";
import { loadModule } from "./load-module";
import { CodeBundle } from "@braintrust/core/typespecs/dist";
import path from "path";

interface SourceMapContext {
  inFiles: Record<string, string[]>;
  outFileModule: EvaluatorFile;
  outFileLines: string[];
  sourceMapDir: string;
  sourceMap: SourceMapConsumer;
}

export async function makeSourceMapContext({
  inFile,
  outFile,
  sourceMapFile,
}: {
  inFile: string;
  outFile: string;
  sourceMapFile: string;
}): Promise<SourceMapContext> {
  const [inFileContents, outFileContents, sourceMap] = await Promise.all([
    fs.readFile(inFile, "utf8"),
    fs.readFile(outFile, "utf8"),
    (async () => {
      const sourceMap = await fs.readFile(sourceMapFile, "utf8");
      const sourceMapJSON = JSON.parse(sourceMap);
      return new SourceMapConsumer(sourceMapJSON);
    })(),
  ]);
  return {
    inFiles: { [inFile]: inFileContents.split("\n") },
    outFileModule: loadModule({ inFile, moduleText: outFileContents }),
    outFileLines: outFileContents.split("\n"),
    sourceMapDir: path.dirname(sourceMapFile),
    sourceMap,
  };
}

function isNative(fn: Function): boolean {
  return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
}

function locationToString(location: CodeBundle["location"]): string {
  if (location.type === "experiment") {
    return `eval ${location.eval_name} -> ${location.position.type}`;
  } else {
    return `task ${location.index}`;
  }
}

export async function findCodeDefinition({
  location,
  ctx: { inFiles, outFileModule, outFileLines, sourceMapDir, sourceMap },
}: {
  location: CodeBundle["location"];
  ctx: SourceMapContext;
}): Promise<string | undefined> {
  let fn: Function | undefined = undefined;

  if (location.type === "experiment") {
    const evaluator = outFileModule.evaluators[location.eval_name]?.evaluator;
    if (!evaluator) {
      console.warn(
        warning(
          `Failed to find evaluator for ${location.eval_name}. Will not display preview.`,
        ),
      );
      return undefined;
    }

    fn =
      location.position.type === "task"
        ? evaluator.task
        : evaluator.scores[location.position.index];
  } else {
    fn = outFileModule.functions[location.index].handler;
  }

  if (!fn) {
    console.warn(
      warning(
        `Failed to find ${locationToString(location)}. Will not display preview.`,
      ),
    );
    return undefined;
  }

  const sourceCode = fn.toString();
  if (isNative(fn)) {
    return undefined;
  }
  let lineNumber = 0;
  let columnNumber = -1;
  for (const line of outFileLines) {
    const sourceDefinition = line.indexOf(sourceCode);
    if (sourceDefinition !== -1) {
      columnNumber = sourceDefinition;
      break;
    }
    lineNumber++;
  }

  if (columnNumber === -1) {
    console.warn(warning(`Failed to find code definition for ${fn.name}`));
    return undefined;
  }
  const originalPosition = sourceMap.originalPositionFor({
    line: lineNumber + 1,
    column: columnNumber + 1,
  });

  if (originalPosition.source === null || originalPosition.line === null) {
    return undefined;
  }

  if (!inFiles[originalPosition.source]) {
    const originalFile = path.join(sourceMapDir, originalPosition.source);
    inFiles[originalPosition.source] = (
      await fs.readFile(originalFile, "utf-8")
    ).split("\n");
  }

  const originalLines = inFiles[originalPosition.source];
  const endMapping = findNextMapping(
    sourceMap,
    originalPosition.source,
    originalPosition.line,
    originalPosition.column,
    originalLines,
  );

  const ret = extractFunctionDefinition({
    start: {
      line: originalPosition.line,
      column: originalPosition.column,
    },
    end: endMapping
      ? {
          line: endMapping.originalLine,
          column: endMapping.originalColumn,
        }
      : null,
    lines: originalLines,
  });
  return ret.length === 0 ? undefined : ret.slice(0, 10240);
}

export function extractFunctionDefinition({
  start,
  end,
  lines,
}: {
  start: { line: number; column: number | null };
  end: { line: number; column: number | null } | null;
  lines: string[];
}) {
  // Extract the function definition
  let functionDefinition = "";
  for (let i = start.line - 1; i < lines.length; i++) {
    let line = lines[i];
    if (end && end.column !== null && i === end.line - 1) {
      line = line.slice(0, end.column + 1);
    } else if (
      start.column !== null &&
      start.column > 0 &&
      i === start.line - 1
    ) {
      line = line.slice(start.column - 1);
    } else if (end !== null && i >= end.line) {
      break;
    }

    functionDefinition += line + "\n";
  }

  return functionDefinition.trim();
}

// Add this new function to find the next mapping
function findNextMapping(
  sourceMap: SourceMapConsumer,
  source: string,
  line: number,
  column: number | null,
  lines: string[],
): MappingItem | null {
  let nextMapping: MappingItem | null = null;
  let finished = false;
  sourceMap.eachMapping(
    (mapping: MappingItem) => {
      if (mapping.source !== source || finished) {
        return;
      }
      if (
        mapping.originalLine > line &&
        mapping.originalColumn <= (column ?? 0)
      ) {
        if (
          nextMapping &&
          lines[mapping.originalLine - 1][mapping.originalColumn] !== "}"
        ) {
          // If we've already collected a }, and we encounter a non-}, then we've found
          // the end of the function definition. In the worst case, this will result in
          // two functions.
          finished = true;
        } else if (
          lines[mapping.originalLine - 1][mapping.originalColumn] === "}"
        ) {
          nextMapping = mapping;
        }
      }
    },
    undefined,
    SourceMapConsumer.ORIGINAL_ORDER,
  );
  return nextMapping;
}
