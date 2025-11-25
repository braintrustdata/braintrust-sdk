import { nunjucks } from "./nunjucks";
const nunjucksParser = (nunjucks as any).parser;
const nunjucksNodes = (nunjucks as any).nodes;

type NodesModule = typeof nunjucksNodes;
type NunjucksNode = InstanceType<NodesModule["Node"]>;
type SymbolNode = InstanceType<NodesModule["Symbol"]>;
type LookupValNode = InstanceType<NodesModule["LookupVal"]>;
type NodeListNode = InstanceType<NodesModule["NodeList"]>;
type ForNode = InstanceType<NodesModule["For"]>;
type SetNode = InstanceType<NodesModule["Set"]>;
type MacroNode = InstanceType<NodesModule["Macro"]>;
type BlockNode = InstanceType<NodesModule["Block"]>;
type ImportNode = InstanceType<NodesModule["Import"]>;
type FromImportNode = InstanceType<NodesModule["FromImport"]>;
type FilterNode = InstanceType<NodesModule["Filter"]>;
type FunCallNode = InstanceType<NodesModule["FunCall"]>;
type CallExtensionNode = InstanceType<NodesModule["CallExtension"]>;
type PairNode = InstanceType<NodesModule["Pair"]>;
type KeywordArgsNode = InstanceType<NodesModule["KeywordArgs"]>;
type LiteralNode = InstanceType<NodesModule["Literal"]>;

type ScopeStack = Array<Set<string>>;

const BUILTIN_GLOBALS = new Set<string>([
  "range",
  "cycler",
  "joiner",
  "namespace",
  "super",
  "caller",
]);

// Test to format missing numeric index in nunjucks array
const NUMERIC_SEGMENT = /^\d+$/;

export const lintTemplate = (
  template: string,
  context: Record<string, unknown>,
) => {
  let root: NodeListNode;
  try {
    root = nunjucksParser.parse(template) as NodeListNode;
  } catch {
    throw new Error(`Invalid nunjucks template: ${template}.`);
  }
  const variablePaths = collectVariablePaths(root);
  for (const path of variablePaths) {
    if (!pathExists(context, path)) {
      throw new Error(`Variable '${formatPath(path)}' does not exist.`);
    }
  }
};

// Use the parsed AST to collect variable lookup paths that must be present in the context.
function collectVariablePaths(root: NodeListNode): string[][] {
  const seen = new Map<string, string[]>();
  const scopeStack: ScopeStack = [new Set(BUILTIN_GLOBALS)];
  let optionalDepth = 0;

  type Frame =
    | { type: "visit"; node: NunjucksNode | null }
    | { type: "restore"; action: () => void }
    | { type: "add"; names: string[] }
    | {
        type: "forBody";
        body: NunjucksNode | null;
        elseBody: NunjucksNode | null;
        loopNames: string[];
      }
    | { type: "optionalVisit"; node: NunjucksNode | null };

  const stack: Frame[] = [{ type: "visit", node: root }];

  const record = (path: string[]) => {
    if (path.length === 0 || optionalDepth > 0) {
      return;
    }
    const key = path.join("\u0001");
    if (!seen.has(key)) {
      seen.set(key, path);
    }
  };

  const isDefined = (name: string) => {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      if (scopeStack[i].has(name)) {
        return true;
      }
    }
    return false;
  };

  const addToCurrentScope = (names: string[]) => {
    if (names.length === 0) {
      return;
    }
    const current = scopeStack[scopeStack.length - 1];
    for (const name of names) {
      if (name) {
        current.add(name);
      }
    }
  };

  while (stack.length > 0) {
    const frame = stack.pop()!;
    switch (frame.type) {
      case "restore": {
        frame.action();
        continue;
      }
      case "add": {
        addToCurrentScope(frame.names);
        continue;
      }
      case "forBody": {
        const scope = new Set<string>();
        for (const name of frame.loopNames) {
          if (name) {
            scope.add(name);
          }
        }
        scopeStack.push(scope);
        stack.push({
          type: "restore",
          action: () => {
            scopeStack.pop();
          },
        });
        if (frame.elseBody) {
          stack.push({ type: "visit", node: frame.elseBody });
        }
        if (frame.body) {
          stack.push({ type: "visit", node: frame.body });
        }
        continue;
      }
      case "optionalVisit": {
        const node = frame.node;
        if (!node) {
          continue;
        }
        optionalDepth++;
        stack.push({
          type: "restore",
          action: () => {
            optionalDepth--;
          },
        });
        stack.push({ type: "visit", node });
        continue;
      }
      case "visit":
        break;
      default:
        continue;
    }

    const node = frame.node;
    if (!node) {
      continue;
    }

    if (isSymbolNode(node)) {
      if (!isDefined(node.value)) {
        record([node.value]);
      }
      continue;
    }

    if (isNodeList(node)) {
      const children = (node as any).children as unknown[];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ type: "visit", node: asNode(children[i]) });
      }
      continue;
    }

    if (isForNode(node)) {
      const loopNames = collectBindingNames(asNode((node as any).name));
      loopNames.push("loop");
      stack.push({
        type: "forBody",
        body: asNode((node as any).body),
        elseBody: asNode((node as any).else_),
        loopNames,
      });
      stack.push({ type: "optionalVisit", node: asNode((node as any).arr) });
      continue;
    }

    if (isSetNode(node)) {
      stack.push({
        type: "add",
        names: collectSetTargets((node as any).targets as NunjucksNode[]),
      });
      stack.push({ type: "visit", node: asNode((node as any).body) });
      stack.push({ type: "visit", node: asNode((node as any).value) });
      continue;
    }

    if (isMacroNode(node)) {
      const { names, defaults } = collectMacroArgs(
        (node as any).args as NodeListNode,
      );
      stack.push({
        type: "add",
        names: [((node as any).name as SymbolNode).value],
      });
      const scope = new Set<string>();
      for (const name of names) {
        if (name) {
          scope.add(name);
        }
      }
      scopeStack.push(scope);
      stack.push({
        type: "restore",
        action: () => {
          scopeStack.pop();
        },
      });
      const bodyNode = asNode((node as any).body);
      if (bodyNode) {
        stack.push({ type: "visit", node: bodyNode });
      }
      for (let i = defaults.length - 1; i >= 0; i--) {
        const defNode = asNode(defaults[i]);
        if (defNode) {
          stack.push({ type: "visit", node: defNode });
        }
      }
      continue;
    }

    if (isBlockNode(node)) {
      stack.push({ type: "visit", node: asNode((node as any).body) });
      continue;
    }

    if (isImportNode(node)) {
      stack.push({
        type: "add",
        names: collectBindingNames(asNode((node as any).target)),
      });
      stack.push({ type: "visit", node: asNode((node as any).template) });
      continue;
    }

    if (isFromImportNode(node)) {
      stack.push({
        type: "add",
        names: collectImportedNames((node as any).names as NodeListNode),
      });
      stack.push({ type: "visit", node: asNode((node as any).template) });
      continue;
    }

    if (isLookupValNode(node)) {
      const path = resolveLookupPath(node);
      if (path && !isDefined(path[0])) {
        record(path);
      }
      stack.push({ type: "visit", node: asNode((node as any).val) });
      stack.push({ type: "visit", node: asNode((node as any).target) });
      continue;
    }

    if (isFilterNode(node)) {
      stack.push({ type: "visit", node: asNode((node as any).args) });
      continue;
    }

    if (isFunCallNode(node)) {
      const argsNode = asNode((node as any).args);
      if (argsNode) {
        stack.push({ type: "optionalVisit", node: argsNode });
      }
      stack.push({ type: "visit", node: asNode((node as any).name) });
      continue;
    }

    if (isCallExtensionNode(node)) {
      const contentArgs = (node as any).contentArgs as unknown[];
      for (let i = contentArgs.length - 1; i >= 0; i--) {
        stack.push({ type: "visit", node: asNode(contentArgs[i]) });
      }
      stack.push({ type: "visit", node: asNode((node as any).args) });
      continue;
    }

    (node as any).iterFields((value: unknown) => {
      if (isNode(value)) {
        stack.push({ type: "visit", node: value });
      } else if (Array.isArray(value)) {
        const elements = value as unknown[];
        for (let i = elements.length - 1; i >= 0; i--) {
          const element = elements[i];
          if (isNode(element)) {
            stack.push({ type: "visit", node: element });
          }
        }
      }
    });
  }

  return Array.from(seen.values());
}

// Find lookup variable names.
function collectBindingNames(node: NunjucksNode | null | undefined): string[] {
  if (!node) {
    return [];
  }
  if (isSymbolNode(node)) {
    return [node.value];
  }
  if (isNodeList(node)) {
    const out: string[] = [];
    for (const child of (node as any).children as unknown[]) {
      out.push(...collectBindingNames(asNode(child)));
    }
    return out;
  }
  if (isPairNode(node)) {
    return collectBindingNames(asNode((node as any).value));
  }
  return [];
}

function collectSetTargets(targets: NunjucksNode[]): string[] {
  const names: string[] = [];
  for (const target of targets) {
    if (isSymbolNode(target)) {
      names.push(target.value);
    } else if (isNodeList(target)) {
      names.push(...collectBindingNames(target));
    }
  }
  return names;
}

// Extract macro argument names and their default expressions.
function collectMacroArgs(args: NodeListNode): {
  names: string[];
  defaults: NunjucksNode[];
} {
  const names: string[] = [];
  const defaults: NunjucksNode[] = [];
  for (const child of (args as any).children as unknown[]) {
    const node = asNode(child);
    if (!node) continue;
    if (isSymbolNode(node)) {
      names.push(node.value);
      continue;
    }
    if (isPairNode(node)) {
      collectPair(node);
      continue;
    }
    if (isKeywordArgsNode(node)) {
      for (const pairNode of (node as any).children as unknown[]) {
        const pair = asNode(pairNode);
        if (pair && isPairNode(pair)) {
          collectPair(pair);
        }
      }
    }
  }
  return { names, defaults };

  function collectPair(pair: PairNode) {
    const keyNode = asNode((pair as any).key);
    if (keyNode && isSymbolNode(keyNode)) {
      names.push(keyNode.value);
    }
    const valueNode = asNode((pair as any).value);
    if (valueNode) {
      defaults.push(valueNode);
    }
  }
}

// Resolve imported symbol names (with aliases) that enter scope.
function collectImportedNames(names: NodeListNode): string[] {
  const out: string[] = [];
  for (const child of (names as any).children as unknown[]) {
    const node = asNode(child);
    if (!node) continue;
    if (isPairNode(node)) {
      const alias = asNode((node as any).value);
      if (alias && isSymbolNode(alias)) {
        out.push(alias.value);
      }
    } else if (isSymbolNode(node)) {
      out.push((node as SymbolNode).value);
    }
  }
  return out;
}

// Build the full lookup path (e.g., user.profile.name) represented by a LookupVal node.
function resolveLookupPath(node: LookupValNode): string[] | null {
  const target = asNode((node as any).target);
  if (!target) {
    return null;
  }
  const base = resolveBasePath(target);
  if (!base) {
    return null;
  }
  const keyNode = asNode((node as any).val);
  if (!keyNode) {
    return base;
  }
  const key = resolveLookupKey(keyNode);
  if (key === null) {
    return base;
  }
  return [...base, key];
}

// Resolve the base portion of a lookup (prior to trailing property/index access).
function resolveBasePath(node: NunjucksNode): string[] | null {
  if (isLookupValNode(node)) {
    return resolveLookupPath(node);
  }
  if (isSymbolNode(node)) {
    return [(node as SymbolNode).value];
  }
  return null;
}

// Determine the literal key/index from a lookup tail node, if statically known.
function resolveLookupKey(node: NunjucksNode): string | null {
  if (isLiteralNode(node)) {
    const literalValue = (node as any).value;
    if (typeof literalValue === "string") {
      return literalValue;
    }
    if (typeof literalValue === "number") {
      return String(literalValue);
    }
  }
  if (isSymbolNode(node)) {
    return null;
  }
  return null;
}

function formatPath(path: string[]): string {
  let formattedPath = "";
  path.forEach((segment, index) => {
    if (NUMERIC_SEGMENT.test(segment)) {
      formattedPath += `[${segment}]`;
    } else if (index === 0) {
      formattedPath += segment;
    } else {
      formattedPath += `.${segment}`;
    }
  });
  return formattedPath;
}

// Verify that the given lookup path has a valid variable
function pathExists(root: Record<string, unknown>, path: string[]): boolean {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return false;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || !(index in current)) {
        return false;
      }
      current = current[index];
      continue;
    }
    if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(segment in obj)) {
        return false;
      }
      current = obj[segment];
      continue;
    }
    return false;
  }
  return true;
}

const isNode = (v: unknown): v is NunjucksNode =>
  v instanceof nunjucksNodes.Node;
const asNode = (v: unknown): NunjucksNode | null => (isNode(v) ? v : null);

const isNodeList = (n: NunjucksNode): n is NodeListNode =>
  n instanceof nunjucksNodes.NodeList;
const isSymbolNode = (n: NunjucksNode): n is SymbolNode =>
  n instanceof nunjucksNodes.Symbol;
const isLookupValNode = (n: NunjucksNode): n is LookupValNode =>
  n instanceof nunjucksNodes.LookupVal;
const isForNode = (n: NunjucksNode): n is ForNode =>
  n instanceof nunjucksNodes.For;
const isSetNode = (n: NunjucksNode): n is SetNode =>
  n instanceof nunjucksNodes.Set;
const isMacroNode = (n: NunjucksNode): n is MacroNode =>
  n instanceof nunjucksNodes.Macro;
const isBlockNode = (n: NunjucksNode): n is BlockNode =>
  n instanceof nunjucksNodes.Block;
const isImportNode = (n: NunjucksNode): n is ImportNode =>
  n instanceof nunjucksNodes.Import;
const isFromImportNode = (n: NunjucksNode): n is FromImportNode =>
  n instanceof nunjucksNodes.FromImport;
const isFilterNode = (n: NunjucksNode): n is FilterNode =>
  n instanceof nunjucksNodes.Filter;
const isFunCallNode = (n: NunjucksNode): n is FunCallNode =>
  n instanceof nunjucksNodes.FunCall;
const isCallExtensionNode = (n: NunjucksNode): n is CallExtensionNode =>
  n instanceof nunjucksNodes.CallExtension;
const isPairNode = (n: NunjucksNode): n is PairNode =>
  n instanceof nunjucksNodes.Pair;
const isKeywordArgsNode = (n: NunjucksNode): n is KeywordArgsNode =>
  n instanceof nunjucksNodes.KeywordArgs;
const isLiteralNode = (n: NunjucksNode): n is LiteralNode =>
  n instanceof nunjucksNodes.Literal;
