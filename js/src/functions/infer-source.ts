import { SourceMapConsumer } from "source-map";
import * as fs from "fs/promises";
import { EvaluatorFile, warning } from "../framework";
import { loadModule } from "./load-module";
import { CodeBundle } from "@braintrust/core/typespecs/dist";
import path from "path";
import type { Node } from "typescript";

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

  // Parse the file with Typescript to find the function definition
  const ts = await getTsModule();
  if (!ts) {
    return undefined;
  }
  const sourceFile = ts.createSourceFile(
    originalPosition.source,
    originalLines.join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );
  let functionNode: Node | undefined = undefined;
  const targetPosition = ts.getPositionOfLineAndCharacter(
    sourceFile,
    originalPosition.line - 1,
    originalPosition.column || 0,
  );

  ts.forEachChild(sourceFile, function visit(node) {
    if (node.pos <= targetPosition && targetPosition < node.end) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)
      ) {
        functionNode = node;
      } else {
        ts.forEachChild(node, visit);
      }
    }
  });

  if (!functionNode) {
    return undefined;
  }

  const printer = ts.createPrinter();
  const functionDefinition = printer.printNode(
    ts.EmitHint.Unspecified,
    functionNode,
    sourceFile,
  );

  return functionDefinition;
}

let tsModule: typeof import("typescript") | undefined = undefined;
async function getTsModule() {
  if (!tsModule) {
    try {
      tsModule = await import("typescript");
    } catch (e) {
      console.warn(
        warning(
          "Failed to load TypeScript module. Will not use Typescript to derive previe.",
        ),
      );
    }
  }
  return tsModule;
}
