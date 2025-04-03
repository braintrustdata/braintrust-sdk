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
  call(input: CallArgs): Node;
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
  private nodes: Record<string, GraphNode | LazyGraphNode> = {};
  private edges: Record<string, GraphEdge> = {};
  private nodeLikeNodes = new Map<unknown, Node>(); // Maps node-like objects, like prompts, to their nodes
  private nodeRegistry = new Map<string, Node>(); // XXX Remove?

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
      Object.entries(this.nodes).map(async ([id, node]) => {
        if (node.type === "lazy") {
          // We should have a .build() on each of these? For prompts, we can just
          // use .build() and use the project id + slug as a reference.
          const built = await this.nodeRegistry.get(node.id)!.build(context);
          return [id, built];
        } else {
          return [id, node];
        }
      }),
    );

    return {
      type: "graph",
      nodes: Object.fromEntries(nodes), // XXX Need to resolve the lazy nodes
      edges: {}, // this.edges,
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
    return resolved.call(input);
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
  private createInputNode(): InputNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "input",
      description: "Input to the graph",
      position: null,
    };

    this.nodes[id] = node;
    const inputNode = new InputNode(this, id);
    this.nodeRegistry.set(id, inputNode);
    return inputNode;
  }

  // Create an output node
  private createOutputNode(): OutputNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "output",
      description: "Output of the graph",
      position: null,
    };

    this.nodes[id] = node;
    const outputNode = new OutputNode(this, id);
    this.nodeRegistry.set(id, outputNode);
    return outputNode;
  }

  // Create a prompt node from a CodePrompt
  public createPromptNode(prompt: Prompt): PromptNode {
    const id = newId();

    this.nodes[id] = {
      type: "lazy",
      id,
    };
    const promptNode = new PromptNode(this, id, prompt);
    this.nodeRegistry.set(id, promptNode);
    return promptNode;
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
    const gateNode = new GateNode(this, id);
    this.nodeRegistry.set(id, gateNode);
    return gateNode;
  }

  // Create a literal node
  public literal<T>(value: T): LiteralNode<T> {
    console.log("literal", value);
    const id = this.generateId();
    const node: GraphNode = {
      type: "literal",
      value,
      position: null,
    };

    this.nodes[id] = node;
    const literalNode = new LiteralNode<T>(this, id, value);
    this.nodeRegistry.set(id, literalNode);
    return literalNode;
  }

  public gate(options: {
    condition: NodeLike;
    true: NodeLike;
    false: NodeLike;
  }): GateNode {
    const id = this.generateId();
    const node: GraphNode = {
      type: "gate",
      description: "Conditional gate",
      position: null,
    };
    this.nodes[id] = node;
    const gateNode = new GateNode(this, id);
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

function isProxyVariable(node: unknown): node is ProxyVariable {
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
        this.graph.connect(callableThis, result);
      } else {
        const node = this.graph.resolveNode(arg);
        lastNode = node;
        this.graph.connect(callableThis, node);
      }
    }

    return lastNode;
  }

  public call(input: CallArgs): Node {
    if (isProxyVariable(input)) {
      throw new Error("Not implemented");
    } else if (isNode(input)) {
      this.graph.connect(input, this);
    } else {
      for (const [targetVar, targetNode] of Object.entries(input)) {
        this.graph.connect(
          this.graph.resolveNode(targetNode),
          this,
          "value",
          targetVar,
        );
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
      position: null,
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
      position: null,
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
      position: null,
    };
  }
}

// Gate node for conditional branching
export class GateNode extends BaseNode implements Node {
  constructor(graph: GraphBuilder, id: string) {
    super(graph, id);
  }

  public async build(context: BuildContext): Promise<GraphNode> {
    return {
      type: "gate",
      description: "Conditional gate",
      position: null,
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

// Export the graph constructor
export default { createGraph };
