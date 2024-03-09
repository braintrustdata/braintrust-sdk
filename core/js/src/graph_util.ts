// Mirror of the functions in core/py/src/braintrust_core/graph_util.py.

import { mapAt } from "./util";

export interface UndirectedGraph {
  vertices: number[];
  edges: Set<[number, number]>;
}

export type AdjacencyListGraph = Map<number, Set<number>>;

export function depthFirstSearch(args: {
  graph: AdjacencyListGraph;
  firstVisitF?: (vertex: number) => void;
  lastVisitF?: (vertex: number) => void;
  visitationOrder?: number[];
}) {
  const { graph, firstVisitF, lastVisitF } = args;

  for (const vs of graph.values()) {
    for (const v of vs.values()) {
      if (!(v in graph)) {
        throw new Error(`Outgoing vertex ${v} must be a key in the graph`);
      }
    }
  }

  const firstVisitedVertices: Set<number> = new Set();
  const visitationOrder = args.visitationOrder ?? [...graph.keys()];
  const events: { eventType: "first" | "last"; vertex: number }[] =
    visitationOrder
      .map((vertex) => ({ eventType: "first", vertex } as const))
      .reverse();
  while (events.length) {
    const { eventType, vertex } = events.pop()!;

    if (eventType === "last") {
      lastVisitF?.(vertex);
      continue;
    }

    if (firstVisitedVertices.has(vertex)) {
      continue;
    }
    firstVisitedVertices.add(vertex);
    firstVisitF?.(vertex);

    events.push({ eventType: "last", vertex });
    mapAt(graph, vertex).forEach((vertex) => {
      events.push({ eventType: "first", vertex });
    });
  }
}

export function undirectedConnectedComponents(
  graph: UndirectedGraph
): number[][] {
  const directedGraph: AdjacencyListGraph = new Map(
    graph.vertices.map((v) => [v, new Set<number>()])
  );
  for (const [i, j] of graph.edges) {
    mapAt(directedGraph, i).add(j);
    mapAt(directedGraph, j).add(i);
  }

  let labelCounter = 0;
  const vertexLabels: Map<number, number> = new Map();
  const preorderTraversal: number[] = [];
  function firstVisitF(vertex: number) {
    let label =
      preorderTraversal.length > 0 &&
      mapAt(directedGraph, vertex).has(
        preorderTraversal[preorderTraversal.length - 1]
      )
        ? vertexLabels.get(preorderTraversal[preorderTraversal.length - 1])
        : undefined;
    if (label === undefined) {
      label = labelCounter++;
    }
    vertexLabels.set(vertex, label);
    preorderTraversal.push(vertex);
  }

  depthFirstSearch({ graph: directedGraph, firstVisitF });
  const output: number[][] = Array.from({ length: labelCounter }).map(() => []);
  for (const [vertex, label] of vertexLabels.entries()) {
    output[label].push(vertex);
  }
  return output;
}

export function topologicalSort(
  graph: AdjacencyListGraph,
  visitationOrder?: number[]
): number[] {
  const reverseOrdering: number[] = [];
  function lastVisitF(vertex: number) {
    reverseOrdering.push(vertex);
  }
  depthFirstSearch({ graph, lastVisitF, visitationOrder });
  return reverseOrdering.reverse();
}
