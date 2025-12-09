import * as nunjucks from "nunjucks";

const nunjucksParser = (nunjucks as any).parser;
const nunjucksLexer = (nunjucks as any).lexer;

export interface VariableUsage {
  path: string[]; // full path of the variable (nested)
  from: number; // start index in template string
  to: number; // end index in template string
  lineno: number; // line number (1-based)
  colno: number; // column number (1-based)
}

function formatPath(path: string[]): string {
  let result = path[0] || "";
  for (let i = 1; i < path.length; i++) {
    const part = path[i];
    if (/^\d+$/.test(part)) {
      result += `[${part}]`;
    } else {
      result += `.${part}`;
    }
  }
  return result;
}

export function getEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: false,
  });
}

export function getStrictEnv() {
  return new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: true,
  });
}

export function lintTemplate(template: string, context: any): void {
  const usages = analyzeNunjucksTemplateWithLocations(template);

  for (const usage of usages) {
    let current: any = context;

    for (let i = 0; i < usage.path.length; i++) {
      const part = usage.path[i];

      if (current === null || current === undefined) {
        throw new Error(`Variable '${formatPath(usage.path)}' does not exist.`);
      }

      if (/^\d+$/.test(part)) {
        // Numeric index access
        const idx = parseInt(part, 10);
        if (!Array.isArray(current)) {
          throw new Error(
            `Variable '${formatPath(usage.path)}' does not exist.`,
          );
        }
        if (idx >= current.length) {
          throw new Error(
            `Variable '${formatPath(usage.path)}' does not exist.`,
          );
        }
        current = current[idx];
      } else {
        // Property access
        if (!(part in current)) {
          throw new Error(
            `Variable '${formatPath(usage.path)}' does not exist.`,
          );
        }
        current = current[part];
      }
    }
  }
}

type Scope = Record<string, true>;

interface LoopContext {
  alias: string;
  iterablePath: string[];
}

// Common Nunjucks built-in filters that should not be tracked as variables
const BUILTIN_FILTERS = new Set([
  "abs",
  "batch",
  "capitalize",
  "center",
  "default",
  "dictsort",
  "dump",
  "escape",
  "first",
  "float",
  "forceescape",
  "groupby",
  "indent",
  "int",
  "join",
  "last",
  "length",
  "list",
  "lower",
  "nl2br",
  "random",
  "reject",
  "rejectattr",
  "replace",
  "reverse",
  "round",
  "safe",
  "select",
  "selectattr",
  "slice",
  "sort",
  "string",
  "striptags",
  "sum",
  "title",
  "trim",
  "truncate",
  "upper",
  "urlencode",
  "urlize",
  "wordcount",
  "wordwrap",
  "e",
  "d",
]);

// Nunjucks built-in test functions that should not be tracked as variables
const BUILTIN_TESTS = new Set([
  "boolean",
  "callable",
  "defined",
  "divisibleby",
  "equalto",
  "escaped",
  "even",
  "false",
  "falsy",
  "float",
  "ge",
  "greaterthan",
  "gt",
  "in",
  "integer",
  "iterable",
  "le",
  "lessthan",
  "lower",
  "lt",
  "mapping",
  "ne",
  "none",
  "null",
  "number",
  "odd",
  "sameas",
  "sequence",
  "string",
  "true",
  "truthy",
  "undefined",
  "upper",
]);

export function analyzeNunjucksTemplate(
  template: string,
  envOptions: any = {},
): string[][] {
  const usages = analyzeNunjucksTemplateWithLocations(template, envOptions);
  return usages.map((u) => u.path);
}

export function analyzeNunjucksTemplateWithLocations(
  template: string,
  envOptions: any = {},
): VariableUsage[] {
  const env = new nunjucks.Environment(null, envOptions);
  let ast;
  try {
    ast = nunjucksParser.parse(template, env);
  } catch (err: any) {
    if (envOptions?.throwOnParseError) throw err;
    return [];
  }

  let tokens: any[] = [];
  try {
    let lexerResult: any;
    if (typeof nunjucksLexer === "function") {
      const Lexer = nunjucksLexer;
      const lexer = new Lexer(env);
      lexerResult = lexer.lex(template);
    } else if (nunjucksLexer && typeof nunjucksLexer.lex === "function") {
      lexerResult = nunjucksLexer.lex(template, env);
    } else if (nunjucksLexer && typeof nunjucksLexer === "function") {
      lexerResult = nunjucksLexer(template);
    }

    if (Array.isArray(lexerResult)) {
      tokens = lexerResult;
    } else if (
      lexerResult &&
      typeof lexerResult[Symbol.iterator] === "function"
    ) {
      tokens = Array.from(lexerResult);
    } else if (lexerResult && lexerResult.tokens) {
      tokens = Array.isArray(lexerResult.tokens) ? lexerResult.tokens : [];
    } else if (lexerResult && typeof lexerResult.next === "function") {
      tokens = Array.from(lexerResult);
    }
  } catch {
    tokens = [];
  }

  const tokenOffsets = tokens.map((t: any) => {
    const from = getCharIndex(t.lineno, t.colno, template);
    return { ...t, from, to: from + t.value.length };
  });

  function getCharIndex(line: number, col: number, template: string) {
    const lines = template.split("\n");
    let index = 0;
    // Nunjucks uses 0-based line and column numbers
    for (let i = 0; i < line; i++) index += lines[i].length + 1;
    index += col;
    return index;
  }

  function findTokenPosition(name: string, lineno: number, colno: number) {
    // First try exact match in tokenized data
    const exactMatch = tokenOffsets.find(
      (t: any) => t.value === name && t.lineno === lineno && t.colno === colno,
    );
    if (exactMatch) {
      return { from: exactMatch.from, to: exactMatch.to, lineno, colno };
    }

    // If exact match fails, search for any token with this value on the same line
    const lineMatch = tokenOffsets.find(
      (t: any) => t.value === name && t.lineno === lineno,
    );
    if (lineMatch) {
      return {
        from: lineMatch.from,
        to: lineMatch.to,
        lineno: lineMatch.lineno,
        colno: lineMatch.colno,
      };
    }

    // Fallback: search for the name in the template string near the given position
    // This is needed because the lexer doesn't tokenize property names in paths like "user.name"
    const lines = template.split("\n");
    const line = lines[lineno] || "";

    // Search for the name in the current line, starting from the given column
    const searchStart = Math.max(0, colno);
    const foundInLine = line.indexOf(name, searchStart);

    if (foundInLine !== -1) {
      // Found it in the line, calculate absolute position
      const from = getCharIndex(lineno, foundInLine, template);
      return { from, to: from + name.length, lineno, colno: foundInLine };
    }

    // Last resort: use the provided position
    const from = getCharIndex(lineno, colno, template);
    return { from, to: from + name.length, lineno, colno };
  }

  const results: VariableUsage[] = [];
  const globalScope: Scope = {};
  const loopStack: LoopContext[] = [];

  function extractPath(expr: any, path: string[]): void {
    if (!expr) return;
    if (expr.typename === "Symbol") {
      path.push(expr.value);
    } else if (expr.typename === "LookupVal") {
      // LookupVal represents target[val] or target.val
      // First get the target path
      if (expr.target) {
        extractPath(expr.target, path);
      }
      // Then add the property/index being accessed
      if (expr.val) {
        if (expr.val.typename === "Literal") {
          path.push(String(expr.val.value));
        } else if (expr.val.typename === "Symbol") {
          path.push(expr.val.value);
        } else {
          extractPath(expr.val, path);
        }
      }
    }
  }

  function resolveLoopAliases(
    path: string[],
    availableLoops: typeof loopStack,
  ): string[] {
    if (path.length === 0) return path;
    const first = path[0];
    const matchingLoop = availableLoops.find((l) => l.alias === first);
    if (matchingLoop) {
      const resolvedIterable = resolveLoopAliases(
        matchingLoop.iterablePath,
        availableLoops.filter((l) => l !== matchingLoop),
      );
      return [
        ...resolvedIterable,
        "0",
        ...resolveLoopAliases(path.slice(1), availableLoops),
      ];
    }
    return path;
  }

  function processVariable(pathParts: string[], node: any, scope: Scope) {
    if (pathParts.length === 0) return;
    const baseVar = pathParts[0];

    // Skip loop.* - these are Nunjucks built-ins
    if (baseVar === "loop") {
      return;
    }

    // Find the node for the last part of the path
    // For LookupVal, the last part is in node.val
    function getLastPartNode(n: any): any {
      if (!n) return n;
      if (n.typename === "LookupVal" && n.val) {
        return n.val;
      }
      return n;
    }

    const lastPartNode = getLastPartNode(node);
    const lastPart = pathParts[pathParts.length - 1];
    const tok =
      lastPartNode && lastPartNode.lineno !== undefined
        ? findTokenPosition(lastPart, lastPartNode.lineno, lastPartNode.colno)
        : findTokenPosition(lastPart, node.lineno, node.colno);

    // Check if it's a loop alias
    const baseLoop = loopStack.find((l) => l.alias === baseVar);
    if (baseLoop) {
      const resolvedPath = resolveLoopAliases(
        [...baseLoop.iterablePath, "0", ...pathParts.slice(1)],
        loopStack.filter((l) => l !== baseLoop),
      );
      results.push({
        path: resolvedPath,
        from: tok.from,
        to: tok.to,
        lineno: tok.lineno,
        colno: tok.colno,
      });
      return;
    }

    // Track if not in scope
    if (!(baseVar in scope)) {
      results.push({
        path: pathParts,
        from: tok.from,
        to: tok.to,
        lineno: tok.lineno,
        colno: tok.colno,
      });
    }
  }

  function traverse(node: any, scope: Scope = {}, localScope: Scope = {}) {
    if (!node) return;
    const combinedScope: Scope = { ...scope, ...localScope, ...globalScope };

    switch (node.typename) {
      case "Symbol":
        {
          const matchingLoop = loopStack.find((l) => l.alias === node.value);
          if (matchingLoop) {
            const resolvedPath = resolveLoopAliases(
              [...matchingLoop.iterablePath, "0"],
              loopStack.filter((l) => l !== matchingLoop),
            );
            const tok = findTokenPosition(node.value, node.lineno, node.colno);
            results.push({
              path: resolvedPath,
              from: tok.from,
              to: tok.to,
              lineno: tok.lineno,
              colno: tok.colno,
            });
          } else if (node.value !== "loop" && !(node.value in combinedScope)) {
            const tok = findTokenPosition(node.value, node.lineno, node.colno);
            results.push({
              path: [node.value],
              from: tok.from,
              to: tok.to,
              lineno: tok.lineno,
              colno: tok.colno,
            });
          }
        }
        break;

      case "LookupVal": {
        const pathParts: string[] = [];
        extractPath(node, pathParts);
        if (pathParts.length > 0) {
          processVariable(pathParts, node, combinedScope);
        }
        // Don't traverse children - we've already processed the full path
        return;
      }

      case "For":
        {
          const loopVar = node.name.value;
          const iterablePath: string[] = [];
          extractPath(node.arr, iterablePath);

          loopStack.push({ alias: loopVar, iterablePath });
          const newLocalScope: Scope = {
            ...localScope,
            [loopVar]: true,
            loop: true as true,
          };

          // Track the iterable
          if (iterablePath.length > 0) {
            const baseVar = iterablePath[0];
            const baseLoop = loopStack
              .slice(0, -1)
              .find((l) => l.alias === baseVar);

            // Resolve any loop aliases in the path
            const basePath = baseLoop
              ? resolveLoopAliases(
                  [baseVar, ...iterablePath.slice(1)],
                  loopStack.slice(0, -1),
                )
              : iterablePath;

            // For LookupVal, the last part is in node.val
            let lastPartNode: any = node.arr;
            if (
              lastPartNode &&
              lastPartNode.typename === "LookupVal" &&
              lastPartNode.val
            ) {
              lastPartNode = lastPartNode.val;
            }
            const lastPart = basePath[basePath.length - 1];
            const tok =
              lastPartNode && lastPartNode.lineno !== undefined
                ? findTokenPosition(
                    lastPart,
                    lastPartNode.lineno,
                    lastPartNode.colno,
                  )
                : findTokenPosition(lastPart, node.arr.lineno, node.arr.colno);

            // Track with [0] to verify it's an array
            results.push({
              path: [...basePath, "0"],
              from: tok.from,
              to: tok.to,
              lineno: tok.lineno,
              colno: tok.colno,
            });
          }

          traverse(node.body, combinedScope, newLocalScope);
          if (node.else_) traverse(node.else_, combinedScope, localScope);

          loopStack.pop();
        }
        break;

      case "Set":
        // Set blocks define new variables - add them to global scope
        if (node.targets && Array.isArray(node.targets)) {
          for (const target of node.targets) {
            if (target.typename === "Symbol") {
              globalScope[target.value] = true;
            }
          }
        }
        // Traverse the value/body to track any variables used in the assignment
        if (node.value) traverse(node.value, combinedScope, localScope);
        if (node.body) traverse(node.body, combinedScope, localScope);
        break;

      case "Capture":
        // Capture wraps the body of a set block
        if (node.body) traverse(node.body, combinedScope, localScope);
        break;

      case "If":
        traverse(node.cond, combinedScope, localScope);
        traverse(node.body, combinedScope, localScope);
        if (node.else_) traverse(node.else_, combinedScope, localScope);
        break;

      case "Macro":
        // Macro definitions add the macro name to global scope
        if (node.name && node.name.value) {
          globalScope[node.name.value] = true;
        }

        const macroScope: Scope = { ...combinedScope };
        if (node.args && node.args.children) {
          for (const arg of node.args.children) {
            if (arg.typename === "Symbol") {
              macroScope[arg.value] = true;
            } else if (arg.typename === "KeywordArgs" && arg.children) {
              // KeywordArgs contains Pair nodes for default parameters
              for (const pair of arg.children) {
                if (
                  pair.typename === "Pair" &&
                  pair.key &&
                  pair.key.typename === "Symbol"
                ) {
                  macroScope[pair.key.value] = true;
                }
              }
            }
          }
        }
        traverse(node.body, macroScope, {});
        break;

      case "Output":
        if (node.children) {
          for (const child of node.children)
            traverse(child, combinedScope, localScope);
        }
        break;

      case "Call":
        if (node.args) traverse(node.args, combinedScope, localScope);
        if (node.name) traverse(node.name, combinedScope, localScope);
        break;

      case "Filter":
        // Traverse the value being filtered (not the filter name)
        // Filter structure: name (filter name), args (filter arguments)
        if (node.name && node.name.typename === "Symbol") {
          // Skip filter name - it's a built-in function, not a variable
          // But if it's a complex expression, traverse it
          if (!BUILTIN_FILTERS.has(node.name.value)) {
            traverse(node.name, combinedScope, localScope);
          }
        } else if (node.name) {
          traverse(node.name, combinedScope, localScope);
        }
        if (node.args) traverse(node.args, combinedScope, localScope);
        break;

      case "Is":
        // Is operator tests a value (e.g., "value is defined")
        // Only traverse the left side (the value being tested)
        // The right side is the test name (built-in function)
        if (node.left) traverse(node.left, combinedScope, localScope);
        if (node.right && node.right.typename === "Symbol") {
          // Skip if it's a built-in test name
          if (!BUILTIN_TESTS.has(node.right.value)) {
            traverse(node.right, combinedScope, localScope);
          }
        } else if (node.right) {
          traverse(node.right, combinedScope, localScope);
        }
        break;

      case "Not":
      case "Neg":
      case "Pos":
        // Unary operators use 'target'
        if (node.target) traverse(node.target, combinedScope, localScope);
        break;

      case "Compare":
        // Compare uses 'expr' and 'ops' (array of CompareOperand)
        if (node.expr) traverse(node.expr, combinedScope, localScope);
        if (node.ops && Array.isArray(node.ops)) {
          for (const op of node.ops) {
            if (op.expr) traverse(op.expr, combinedScope, localScope);
          }
        }
        break;

      case "Or":
      case "And":
      case "Add":
      case "Sub":
      case "Mul":
      case "Div":
      case "FloorDiv":
      case "Mod":
      case "Pow":
        // Binary operators use 'left' and 'right'
        if (node.left) traverse(node.left, combinedScope, localScope);
        if (node.right) traverse(node.right, combinedScope, localScope);
        break;

      case "Group":
        // Group wraps a single expression
        if (node.children) {
          for (const child of node.children)
            traverse(child, combinedScope, localScope);
        }
        break;

      default:
        // Don't traverse children of nodes we've already fully processed
        if (
          node.typename === "LookupVal" ||
          node.typename === "Symbol" ||
          node.typename === "Literal"
        ) {
          return;
        }
        for (const key in node) {
          if (key === "typename" || key === "lineno" || key === "colno")
            continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach((c) => traverse(c, combinedScope, localScope));
          } else if (child && typeof child === "object" && child.typename) {
            traverse(child, combinedScope, localScope);
          }
        }
    }
  }

  traverse(ast);
  return results;
}
