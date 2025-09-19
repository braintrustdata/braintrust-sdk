// Mirror of the functions in py/src/braintrust/graph_util.py.

import { mapAt } from "./object_util";

export interface UndirectedGraph {
  vertices: Set<number>;
  edges: Set<[number, number]>;
}

export type AdjacencyListGraph = Map<number, Set<number>>;

export type FirstVisitF = (
  vertex: number,
  args?: { parentVertex?: number },
) => void;
export type LastVisitF = (vertex: number, args?: {}) => void;

type EventType = {
  eventType: "first" | "last";
  vertex: number;
  extras: {
    parentVertex?: number;
  };
};

export function depthFirstSearch(args: {
  graph: AdjacencyListGraph;
  firstVisitF?: FirstVisitF;
  lastVisitF?: LastVisitF;
  visitationOrder?: number[];
}) {
  const { graph, firstVisitF, lastVisitF } = args;

  for (const vs of graph.values()) {
    for (const v of vs.values()) {
      if (!graph.has(v)) {
        throw new Error(`Outgoing vertex ${v} must be a key in the graph`);
      }
    }
  }

  const firstVisitedVertices: Set<number> = new Set();
  const visitationOrder = args.visitationOrder ?? [...graph.keys()];
  const events: EventType[] = visitationOrder
    .map((vertex) => ({ eventType: "first", vertex, extras: {} }) as const)
    .reverse();
  while (events.length) {
    const { eventType, vertex, extras } = events.pop()!;

    if (eventType === "last") {
      lastVisitF?.(vertex);
      continue;
    }

    if (firstVisitedVertices.has(vertex)) {
      continue;
    }
    firstVisitedVertices.add(vertex);
    firstVisitF?.(vertex, { parentVertex: extras.parentVertex });

    events.push({ eventType: "last", vertex, extras: {} });
    mapAt(graph, vertex).forEach((child) => {
      events.push({
        eventType: "first",
        vertex: child,
        extras: { parentVertex: vertex },
      });
    });
  }
}

export function undirectedConnectedComponents(
  graph: UndirectedGraph,
): number[][] {
  const directedGraph: AdjacencyListGraph = new Map(
    [...graph.vertices].map((v) => [v, new Set<number>()]),
  );
  for (const [i, j] of graph.edges) {
    mapAt(directedGraph, i).add(j);
    mapAt(directedGraph, j).add(i);
  }

  let labelCounter = 0;
  const vertexLabels: Map<number, number> = new Map();
  const firstVisitF: FirstVisitF = (vertex, args) => {
    const label =
      args?.parentVertex !== undefined
        ? mapAt(vertexLabels, args?.parentVertex)
        : labelCounter++;
    vertexLabels.set(vertex, label);
  };

  depthFirstSearch({ graph: directedGraph, firstVisitF });
  const output: number[][] = Array.from({ length: labelCounter }).map(() => []);
  for (const [vertex, label] of vertexLabels.entries()) {
    output[label].push(vertex);
  }
  return output;
}

export function topologicalSort(
  graph: AdjacencyListGraph,
  visitationOrder?: number[],
): number[] {
  const reverseOrdering: number[] = [];
  const lastVisitF: LastVisitF = (vertex) => {
    reverseOrdering.push(vertex);
  };
  depthFirstSearch({ graph, lastVisitF, visitationOrder });
  return reverseOrdering.reverse();
}
