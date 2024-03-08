# Generic graph algorithms.

import dataclasses
from typing import Callable, Dict, List, Optional, Tuple


# An UndirectedGraph consists of a set of vertex labels and a set of edges
# between vertices.
@dataclasses.dataclass
class UndirectedGraph:
    vertices: List[int]
    edges: List[Tuple[int, int]]


# An AdjacencyListGraph is a mapping from vertex label to the list of vertices
# where there is a directed edge from the key to the value.
AdjacencyListGraph = Dict[int, List[int]]


def depth_first_search(
    graph: AdjacencyListGraph,
    first_visit_f: Optional[Callable[int, None]] = None,
    last_visit_f: Optional[Callable[int, None]] = None,
    visitation_order: Optional[List[int]] = None,
) -> None:
    """A general depth-first search algorithm over a directed graph. As it
    traverses the graph, it invokes user-provided hooks when a vertex is *first*
    visited (before visiting its children) and when it is *last* visited (after
    visiting all its children).

    An optional `visitation_order` can be specified, which controls the order in
    which vertices will be first visited (outside of visiting them through a
    different vertex). It can also be used to limit the set of starting vertices
    considered. Otherwise, the DFS will visit all vertices in an unspecfied
    order.
    """

    # Check the validity of the graph.
    for vs in graph.values():
        for v in vs:
            assert v in graph

    first_visited_vertices = set()
    visitation_order = visitation_order if visitation_order is not None else graph.keys()
    events = list(reversed([("first", x) for x in visitation_order]))
    while events:
        event_type, vertex = events.pop()

        if event_type == "last":
            if last_visit_f:
                last_visit_f(vertex)
            continue

        # First visit of a node. If we've already visited it, skip.
        if vertex in first_visited_vertices:
            continue
        first_visited_vertices.add(vertex)
        if first_visit_f:
            first_visit_f(vertex)

        # Add 'first' visitation events for all the children of the vertex to
        # the stack. But before this, add a 'last' visitation event for this
        # vertex, so that once we've completed all the children, we get the last
        # visitation event for this one.
        events.append(("last", vertex))
        for child in graph[vertex]:
            events.append(("first", child))


def undirected_connected_components(graph: UndirectedGraph) -> List[List[int]]:
    """Group together all the connected components of an undirected graph.
    Return each group as a list of vertices.
    """

    # Perhaps the most performant way to implement this is via union find. But
    # in lieu of that, we can use a depth-first search over a direct-ified
    # version of the graph. Upon the first visit of each vertex, we assign it a
    # label equal to the label of any of its neighbors. If it has no neighbors,
    # or the neighbors have not been labeled, we assign a new label. At the end,
    # we can group together all the vertices with the same label.

    directed_graph = {v: [] for v in graph.vertices}
    for i, j in graph.edges:
        directed_graph[i].append(j)
        directed_graph[j].append(i)

    label_counter = 0
    vertex_labels = {}

    def first_visit_f(vertex):
        nonlocal label_counter

        label = None
        for child in directed_graph[vertex]:
            label = vertex_labels.get(child)
            if label is not None:
                break
        if label is None:
            label = label_counter
            label_counter += 1
        vertex_labels[vertex] = label

    depth_first_search(directed_graph, first_visit_f=first_visit_f)
    output = [[] for _ in range(label_counter)]
    for vertex, label in vertex_labels.items():
        output[label].append(vertex)

    return output


def topological_sort(graph: AdjacencyListGraph, visitation_order: Optional[List[int]] = None) -> List[int]:
    """The topological_sort function accepts a graph as input, with edges from
    parents to children. It returns an ordering where parents are guaranteed to
    come before their children.

    The `visitation_order` is forwarded directly to `depth_first_search`.

    Ordering with respect to cycles is unspecified. It is the caller's
    responsibility to check for cycles if it matters.
    """

    # We use DFS, where upon the 'last' visitation of a node, we append it to
    # the final ordering. Then we reverse the list at the end.
    reverse_ordering = []

    def last_visit_f(vertex):
        reverse_ordering.append(vertex)

    depth_first_search(graph, last_visit_f=last_visit_f, visitation_order=visitation_order)
    reverse_ordering.reverse()
    return reverse_ordering
