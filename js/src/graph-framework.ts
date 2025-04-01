import type {
  GraphData,
  GraphNode,
  GraphEdge,
} from "@braintrust/core/typespecs/graph";
import { CodeFunction } from "./framework2";
import { newId, Prompt } from "./logger";

// Base interface for all node types
export interface INode {
  readonly id: string;
}

type AnyNodeImpl =
  | InputNode
  | OutputNode
  | PromptNode
  | FunctionNode<unknown, unknown>
  | GateNode
  | ConditionalGateNode
  | LiteralNode<unknown>;

type CallArgs = ProxyVariable | Node | Record<string, ProxyVariable | Node>;

interface CallableNode extends BaseNode {
  (input: CallArgs): Node;
}

// Type to represent node types in our graph
export type Node = AnyNodeImpl & CallableNode;

export type NodeLike = Node | Prompt<boolean, boolean> | ProxyVariable;

export type LazyGraphNode = {
  type: "lazy";
  id: string;
};

// Graph builder class to convert functional chains to GraphData
export class GraphBuilder {
  private nodes: Record<string, GraphNode | LazyGraphNode> = {};
  private edges: Record<string, GraphEdge> = {};
  private nodeLikeNodes = new Map<unknown, Node>(); // Maps node-like objects, like prompts, to their nodes
  private nodeRegistry = new Map<string, Node>(); // XXX Remove?

  // Special nodes
  public readonly IN: InputNode & CallableNode;
  public readonly OUT: OutputNode & CallableNode;

  constructor() {
    // Create input and output nodes
    this.IN = this.createInputNode();
    this.OUT = this.createOutputNode();
  }

  // Create the final GraphData object
  public build(): GraphData {
    return {
      type: "graph",
      // @ts-ignore
      nodes: this.nodes, // XXX Need to resolve the lazy nodes
      edges: this.edges,
    };
  }

  public resolveNode(node: NodeLike): Node {
    if (node instanceof Prompt) {
      const cached = this.nodeLikeNodes.get(node);
      if (cached) {
        return cached;
      }
      const promptNode = this.createPromptNode(node);
      this.nodeLikeNodes.set(node, promptNode);
      return promptNode;
    } else if (isProxyVariable(node)) {
      // XXX Need to propagate the path, somehow
      return proxyVariableToNode(node);
    } else {
      return node;
    }
  }

  public call(node: NodeLike, input: ProxyVariable): Node {
    const resolved = this.resolveNode(node);
    console.log("resolved", resolved);
    const rn = makeNodeCallable(resolved);
    console.log("rn", rn);
    return rn(input);
  }

  // Helper to generate node IDs
  private generateId(): string {
    return newId();
  }

  // Add a node to the graph
  private addNode(node: GraphNode): string {
    const id = this.generateId();
    this.nodes[id] = node;
    return id;
  }

  // Add an edge to the graph
  private addEdge(edge: GraphEdge): string {
    const id = this.generateId();
    this.edges[id] = edge;
    return id;
  }

  // Create an input node
  private createInputNode(): InputNode & CallableNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "input",
      description: "Input to the graph",
      position: null,
    };

    this.nodes[id] = node;
    const inputNode = makeNodeCallable(new InputNode(this, id));
    this.nodeRegistry.set(id, inputNode);
    return inputNode;
  }

  // Create an output node
  private createOutputNode(): OutputNode & CallableNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "output",
      description: "Output of the graph",
      position: null,
    };

    this.nodes[id] = node;
    const outputNode = makeNodeCallable(new OutputNode(this, id));
    this.nodeRegistry.set(id, outputNode);
    return outputNode;
  }

  // Create a prompt node from a CodePrompt
  public createPromptNode(prompt: Prompt): PromptNode & CallableNode {
    const id = newId();

    this.nodes[id] = {
      type: "lazy",
      id,
    };
    const promptNode = makeNodeCallable(new PromptNode(this, id, prompt));
    this.nodeRegistry.set(id, promptNode);
    return promptNode;
  }

  // Create a function node from a CodeFunction
  public createFunctionNode<T, R>(
    func: CodeFunction<T, R, (input: T) => Promise<R>>,
  ): FunctionNode<T, R> {
    const id = this.generateId();
    // Simplified approach to avoid type issues
    const node: GraphNode = {
      type: "function",
      // @ts-ignore: simplified implementation for prototype
      function: { project_name: func.project.name || "", slug: func.slug },
      description: func.description ?? func.name,
      position: null,
    };

    this.nodes[id] = node;
    const functionNode = makeNodeCallable(
      new FunctionNode<T, R>(this, id, func),
    );
    this.nodeRegistry.set(id, functionNode);
    return functionNode;
  }

  // XXX Dead code?
  // Create a gate node for conditional branching
  public createGateNode(): GateNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "gate",
      description: "Conditional gate",
      position: null,
    };

    this.nodes[id] = node;
    const gateNode = makeNodeCallable(new GateNode(this, id));
    this.nodeRegistry.set(id, gateNode);
    return gateNode;
  }

  // Create a literal node
  public literal<T>(value: T): LiteralNode<T> & CallableNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "literal",
      value,
      description: "Literal value",
      position: null,
    };

    this.nodes[id] = node;
    const literalNode = makeNodeCallable(new LiteralNode<T>(this, id, value));
    this.nodeRegistry.set(id, literalNode);
    return literalNode;
  }

  public gate(options: {
    condition: NodeLike;
    true: NodeLike;
    false: NodeLike;
  }): GateNode & CallableNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "gate",
      description: "Conditional gate",
      position: null,
    };
    this.nodes[id] = node;
    const gateNode = makeNodeCallable(new GateNode(this, id));
    this.nodeRegistry.set(id, gateNode);
    return gateNode;
  }

  // Connect two nodes with an edge
  public connect(
    source: Node,
    target: Node,
    sourceVar = "value",
    targetVar = "value",
  ): void {
    const edge: GraphEdge = {
      source: {
        node: source.id,
        variable: sourceVar,
      },
      target: {
        node: target.id,
        variable: targetVar,
      },
    };

    this.addEdge(edge);
  }

  // Get a node by ID
  public getNode(id: string): Node | undefined {
    return this.nodeRegistry.get(id);
  }

  // Register an external node
  public registerNode(nodeId: string, node: Node, nodeObject: GraphNode): void {
    this.nodes[nodeId] = nodeObject;
    this.nodeRegistry.set(nodeId, node);
  }
}

export type ProxyVariable = {
  [key: string]: ProxyVariable;
};

function isProxyVariable(node: NodeLike): node is ProxyVariable {
  return (
    typeof node === "object" &&
    node !== null &&
    "__type" in node &&
    // @ts-ignore
    node.__type === "proxy-variable"
  );
}

function proxyVariableToNode(proxy: ProxyVariable): Node {
  // @ts-ignore
  return proxy.__node;
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
abstract class BaseNode implements INode {
  constructor(
    protected graph: GraphBuilder,
    public readonly id: string,
  ) {}

  // Connect this node to another node
  public then(...args: Array<NodeLike | TransformFn>): Node {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const callableThis: Node = this as unknown as Node;
    let lastNode: Node = callableThis;

    // Connect each arg to this node
    for (const arg of args) {
      // Handle different types of arguments
      if (typeof arg === "function") {
        const argsProxy = createVariableProxy({ path: [], node: callableThis });
        const result = arg(argsProxy);
        lastNode = result;
        this.graph.connect(callableThis, result);
      } else {
        const node = this.graph.resolveNode(arg);
        lastNode = node;
        this.graph.connect(callableThis, node);
      }
    }

    return lastNode;
  }

  public __call(input: CallArgs): Node {
    if (typeof input === "object" && input !== null && "__type" in input) {
      throw new Error("Not implemented");
    } else {
      //   const literalNode = this.graph.createLiteralNode(input);
      throw new Error("TODO: Wire up the literal node");
    }
  }
}

function makeNodeCallable<T extends BaseNode>(node: T): T & CallableNode {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return new Proxy(node, {
    apply(target, thisArg, args) {
      console.log("apply", target, thisArg, args);
      return node.__call(args[0]);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  }) as T & CallableNode;
}

// Input node (entry point to the graph)
export class InputNode extends BaseNode {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }
}

// Output node (exit point from the graph)
export class OutputNode extends BaseNode {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }
}

// Prompt node (wrapper for CodePrompt)
export class PromptNode extends BaseNode {
  constructor(
    graph: GraphBuilder,
    id: string,
    private prompt: Prompt,
  ) {
    super(graph, id);
  }
}

// Function node (wrapper for CodeFunction)
export class FunctionNode<T, R> extends BaseNode {
  constructor(
    graph: GraphBuilder,
    id: string,
    private func: CodeFunction<T, R, (input: T) => Promise<R>>,
  ) {
    super(graph, id);
  }
}

// Gate node for conditional branching
export class GateNode extends BaseNode {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }

  // Create a gate with condition and branches
  public static create(
    graph: GraphBuilder,
    options: {
      condition: string | boolean | ((input: unknown) => boolean);
      true: Node;
      false: Node;
    },
  ): ConditionalGateNode {
    // Create the ConditionalGateNode directly
    const gateNode = graph.createGateNode();
    return new ConditionalGateNode(graph, gateNode.id, options);
  }
}

// Conditional gate node for more complex branching
export class ConditionalGateNode extends BaseNode {
  constructor(
    graph: GraphBuilder,
    id: string,
    private options: {
      condition: string | boolean | ((input: unknown) => boolean);
      true: Node;
      false: Node;
    },
  ) {
    super(graph, id);
  }
}

// Literal node for constant values
export class LiteralNode<T> extends BaseNode {
  constructor(
    graph: GraphBuilder,
    id: string,
    private value: T,
  ) {
    super(graph, id);
  }
}

// Create a graph instance with IN and OUT nodes
export function createGraph(): GraphBuilder {
  const graphBuilder = new GraphBuilder();
  return graphBuilder;
}

// Export the graph constructor
export default { createGraph };
