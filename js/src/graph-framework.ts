import type {
  GraphData,
  GraphNode,
  GraphEdge,
} from "@braintrust/core/typespecs/graph";
import { CodeFunction } from "./framework2";
import { newId, Prompt } from "./logger";
import { J } from "vitest/dist/chunks/reporters.nr4dxCkA";

// Base interface for all node types
export interface INode {
  readonly id: string;
}

// Type to represent node types in our graph
export type Node =
  | InputNode
  | OutputNode
  | PromptNode
  | FunctionNode<unknown, unknown>
  | GateNode
  | ConditionalGateNode
  | LiteralNode<unknown>;

export type NodeLike = Node | Prompt;

export type LazyGraphNode = {
  type: "lazy";
  id: string;
};

// Type for transform functions
export type TransformFn<T, R> = (input: T) => R;

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
  public build(): GraphData {
    return {
      type: "graph",
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
    } else {
      return node;
    }
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
    const functionNode = new FunctionNode<T, R>(this, id, func);
    this.nodeRegistry.set(id, functionNode);
    return functionNode;
  }

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
  public createLiteralNode<T>(value: T): LiteralNode<T> {
    const id = this.generateId();
    const node: GraphNode = {
      type: "literal",
      value,
      description: "Literal value",
      position: null,
    };

    this.nodes[id] = node;
    const literalNode = new LiteralNode<T>(this, id, value);
    this.nodeRegistry.set(id, literalNode);
    return literalNode;
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

// Base Node class for common functionality
abstract class BaseNode implements INode {
  constructor(
    protected graph: GraphBuilder,
    public readonly id: string,
  ) {}

  // Connect this node to another node
  public then(...args: Array<NodeLike | TransformFn<unknown, unknown>>): Node {
    if (args.length === 0) {
      return this;
    }

    // Connect each arg to this node
    for (const arg of args) {
      // Handle different types of arguments
      if (typeof arg === "function") {
        // Transform function
        throw new Error("Individual transform functions not implemented yet");
      } else {
        const node = this.graph.resolveNode(arg);
        // Single node
        this.graph.connect(this, node);
      }
    }
  }

  // Helper method to handle parallel nodes
  private handleParallelNodes(
    source: Node,
    nodes: Node[],
    nextArg: Node | Node[] | TransformFn<unknown, unknown> | undefined,
  ): Node {
    // Connect source to all nodes
    for (const node of nodes) {
      this.graph.connect(source, node);
    }

    // Check if the next argument is a transform function
    if (nextArg && typeof nextArg === "function") {
      // This would create an aggregator with the transform function
      throw new Error(
        "Transform function for parallel execution not implemented yet",
      );
    }

    // Return the last node for chaining
    return nodes[nodes.length - 1];
  }
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

  // Add a value to output
  public call<T>(value: T): void {
    const literalNode = this.graph.createLiteralNode(value);
    this.graph.connect(literalNode, this);
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

  // Call the prompt with parameters
  public call(params: Record<string, unknown>): PromptNode {
    // In a real implementation, we'd handle parameter binding here
    // For now, we'll just return this node for chaining
    return this;
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

  // Call the function with parameters
  public call(params: T): FunctionNode<T, R> {
    // In a real implementation, we'd handle parameter binding here
    // For now, we'll just return this node for chaining
    return this;
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
export function createGraph(): {
  graph: GraphBuilder;
  IN: InputNode;
  OUT: OutputNode;
  gate: (options: {
    condition: string | boolean | ((input: unknown) => boolean);
    true: Node;
    false: Node;
  }) => ConditionalGateNode;
} {
  const graphBuilder = new GraphBuilder();

  return {
    graph: graphBuilder,
    IN: graphBuilder.IN,
    OUT: graphBuilder.OUT,
    gate: (options) => GateNode.create(graphBuilder, options),
  };
}

// Export the graph constructor
export default { createGraph };
