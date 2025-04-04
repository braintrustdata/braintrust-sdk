import type {
  GraphData,
  GraphNode,
  GraphEdge,
} from "@braintrust/core/typespecs/graph";
import { newId, Prompt } from "./logger";
import { FunctionId } from "@braintrust/core/typespecs";

export interface BuildContext {
  getFunctionId(functionObj: unknown): Promise<FunctionId>;
}

// Base interface for all node types
export interface Node {
  readonly id: string;
  __type: "node";
  then(...args: Array<NodeLike | TransformFn>): Node;
  call(input: CallArgs, path?: string[]): Node;
  build(context: BuildContext): Promise<GraphNode>;
}

type CallArgs = ProxyVariable | Node | Record<string, ProxyVariable | Node>;

export type NodeLike = Node | Prompt<boolean, boolean> | ProxyVariable;

export type LazyGraphNode = {
  type: "lazy";
  id: string;
};

// Graph builder class to convert functional chains to GraphData
export class GraphBuilder {
  private nodes = new Map<string, Node>();
  private edges: Record<string, GraphEdge> = {};

  private nodeLikeNodes = new Map<unknown, Node>(); // Maps node-like objects, like prompts, to their nodes

  // Special nodes
  public readonly IN: InputNode;
  public readonly OUT: OutputNode;

  constructor() {
    // Create input and output nodes
    this.IN = this.createInputNode();
    this.OUT = this.createOutputNode();
  }

  // Create the final GraphData object
  public async build(context: BuildContext): Promise<GraphData> {
    const nodes = await Promise.all(
      Array.from(this.nodes.values()).map(async (node) => [
        node.id,
        await node.build(context),
      ]),
    );
    console.log("nodes", nodes);

    return {
      type: "graph",
      nodes: Object.fromEntries(nodes), // XXX Need to resolve the lazy nodes
      edges: this.edges,
    };
  }

  public resolveNode(node: NodeLike): [Node, string[]] {
    if (node instanceof Prompt) {
      const cached = this.nodeLikeNodes.get(node);
      if (cached) {
        return [cached, []];
      }
      const promptNode = this.createPromptNode(node);
      this.nodeLikeNodes.set(node, promptNode);
      return [promptNode, []];
    } else if (isProxyVariable(node)) {
      return proxyVariableToNode(node);
    } else {
      return [node, []];
    }
  }

  // Create a literal node
  public literal<T>(value: T): LiteralNode<T> {
    const id = this.generateId();
    const literalNode = new LiteralNode<T>(this, id, value);
    this.nodes.set(id, literalNode);
    return literalNode;
  }

  public gate(options: {
    condition: NodeLike;
    true: NodeLike;
    false: NodeLike;
  }): GateNode {
    const id = this.generateId();
    const gateNode = new GateNode(this, id, "");
    this.nodes.set(id, gateNode);
    return gateNode;
  }

  public call(node: NodeLike, input: CallArgs): Node {
    const [resolvedNode, path] = this.resolveNode(node);
    return resolvedNode.call(input, path);
  }

  // Helper to generate node IDs
  private generateId(): string {
    return newId();
  }

  // Add an edge to the graph
  private addEdge(edge: GraphEdge): string {
    const id = this.generateId();
    this.edges[id] = edge;
    return id;
  }

  // Create an input node
  private createInputNode(): InputNode {
    const id = this.generateId();
    const inputNode = new InputNode(this, id);
    this.nodes.set(id, inputNode);
    return inputNode;
  }

  // Create an output node
  private createOutputNode(): OutputNode {
    const id = this.generateId();
    const outputNode = new OutputNode(this, id);
    this.nodes.set(id, outputNode);
    return outputNode;
  }

  // Create a prompt node from a CodePrompt
  private createPromptNode(prompt: Prompt): PromptNode {
    const id = this.generateId();

    const promptNode = new PromptNode(this, id, prompt);
    this.nodes.set(id, promptNode);
    return promptNode;
  }

  // Connect two nodes with an edge
  public connect({
    source,
    sourceVar = "value",
    target,
    targetVar = "value",
    path,
  }: {
    source: Node;
    sourceVar?: string;
    target: Node;
    targetVar?: string;
    path?: string[];
  }): void {
    const edge: GraphEdge = {
      source: {
        node: source.id,
        variable: sourceVar,
      },
      target: {
        node: target.id,
        variable: targetVar,
      },
      // TODO: Figure out how to support paths properly
      // expr: path ? escapePath(path) : undefined,
    };

    this.addEdge(edge);
  }
}

export type ProxyVariable = {
  [key: string]: ProxyVariable;
};

function isProxyVariable(node: unknown): node is ProxyVariable {
  return (
    typeof node === "object" &&
    node !== null &&
    "__type" in node &&
    // @ts-ignore
    node.__type === "proxy-variable"
  );
}

function proxyVariableToNode(proxy: ProxyVariable): [Node, string[]] {
  // @ts-ignore
  return [proxy.__node, proxy.__path];
}

// Create a proxy handler that captures property access paths
function createVariableProxy({
  path,
  node,
}: {
  path: string[];
  node: Node;
}): ProxyVariable {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return new Proxy({} as ProxyVariable, {
    get(target, prop) {
      if (typeof prop === "string") {
        if (prop === "__type") {
          return "proxy-variable";
        } else if (prop === "__node") {
          return node;
        } else if (prop === "__path") {
          return path;
        }

        const newPath = [...path, prop];

        // Return a variable reference for terminal properties
        // or a new proxy for further chaining
        return createVariableProxy({ path: newPath, node });
      }
      return undefined;
    },
    has(target, prop) {
      return typeof prop === "string";
    },
  });
}

// Type for transform functions
export type TransformFn = (input: ProxyVariable) => Node;

// Base Node class for common functionality
abstract class BaseNode implements Node {
  public readonly __type = "node";

  constructor(
    protected graph: GraphBuilder,
    public readonly id: string,
  ) {}

  // Connect this node to another node
  public then(...args: Array<NodeLike | TransformFn>): Node {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const callableThis = this as unknown as Node;
    let lastNode: Node = callableThis;

    // Connect each arg to this node
    for (const arg of args) {
      // Handle different types of arguments
      if (typeof arg === "function") {
        const argsProxy = createVariableProxy({ path: [], node: callableThis });
        const result = arg(argsProxy);
        lastNode = result;
        this.graph.connect({ source: callableThis, target: result });
      } else {
        const [node, path] = this.graph.resolveNode(arg);
        lastNode = node;
        this.graph.connect({
          source: callableThis,
          target: node,
          path,
        });
      }
    }

    return lastNode;
  }

  public call(input: CallArgs, path?: string[]): Node {
    if (isProxyVariable(input)) {
      const [sourceNode, sourcePath] = proxyVariableToNode(input);
      this.graph.connect({
        source: sourceNode,
        target: this,
        path: sourcePath,
      });
    } else if (isNode(input)) {
      this.graph.connect({ source: input, target: this, path });
    } else {
      for (const [targetVar, source] of Object.entries(input)) {
        const [sourceNode, sourcePath] = this.graph.resolveNode(source);
        this.graph.connect({
          source: sourceNode,
          sourceVar: "value",
          target: this,
          targetVar,
          path: sourcePath,
        });
      }
    }
    return this;
  }

  abstract build(context: BuildContext): Promise<GraphNode>;
}

function isNode(node: unknown): node is Node {
  return (
    typeof node === "object" &&
    node !== null &&
    "__type" in node &&
    // @ts-ignore
    node.__type === "node"
  );
}

// Input node (entry point to the graph)
export class InputNode extends BaseNode implements Node {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "input",
      description: "Input to the graph",
    };
  }
}

// Output node (exit point from the graph)
export class OutputNode extends BaseNode implements Node {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "output",
      description: "Output of the graph",
    };
  }
}

// Prompt node (wrapper for CodePrompt)
export class PromptNode extends BaseNode implements Node {
  constructor(
    graph: GraphBuilder,
    id: string,
    private prompt: Prompt,
  ) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "function",
      function: await context.getFunctionId(this.prompt),
    };
  }
}

// Gate node for conditional branching
export class GateNode extends BaseNode implements Node {
  constructor(
    graph: GraphBuilder,
    id: string,
    private condition: string,
  ) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "gate",
      description: "Conditional gate",
      // TODO: Figure out how to represent conditional expressions
      // condition: this.condition,
    };
  }
}

// Literal node for constant values
export class LiteralNode<T> extends BaseNode implements Node {
  constructor(
    graph: GraphBuilder,
    id: string,
    private value: T,
  ) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "literal",
      value: this.value,
    };
  }
}

// Create a graph instance with IN and OUT nodes
export function createGraph(): GraphBuilder {
  const graphBuilder = new GraphBuilder();
  return graphBuilder;
}

// XXX write tests
export function escapePath(parts: string[]): string {
  return parts
    .map((part) => {
      if (/[^\w-]/.test(part)) {
        // Escape special characters properly
        const escaped = part.replace(/["\\]/g, "\\$&");
        return `"${escaped}"`;
      }
      return part;
    })
    .join(".");
}

export function unescapePath(path: string): string[] {
  const regex = /"((?:\\["\\]|[^"\\])*)"|([^\.]+)/g;
  const matches = path.match(regex);
  return matches
    ? matches.map((match) => {
        if (match.startsWith('"')) {
          // Remove surrounding quotes and unescape special characters
          return match.slice(1, -1).replace(/\\(["\\])/g, "$1");
        }
        return match;
      })
    : [];
}

// Export the graph constructor
export default { createGraph };
