"""Shortest path search for the flight route graph.

Implements Dijkstra's algorithm (with a binary-heap priority queue) to
find the shortest path between two airports, plus Yen's algorithm to
enumerate alternative loop-free routes sorted by total distance.
"""

import heapq
from collections import defaultdict

from algorithms.distance import haversine


def build_graph(airports, connections):
    """Build an undirected adjacency list from airports + connections.

    airports:    list of airport dicts (must contain code, lat, lon)
    connections: list of {"from": CODE, "to": CODE, "type": ...} dicts

    Returns (graph, coords) where
      graph  = {code: [(neighbour_code, distance_km), ...]}
      coords = {code: (lat, lon)}
    """
    coords = {a["code"]: (a["lat"], a["lon"]) for a in airports}
    graph = defaultdict(list)

    for conn in connections:
        src, dst = conn["from"], conn["to"]
        if src not in coords or dst not in coords:
            # Skip malformed connections instead of crashing the app.
            continue
        lat1, lon1 = coords[src]
        lat2, lon2 = coords[dst]
        d = haversine(lat1, lon1, lat2, lon2)
        # Undirected edge: the route exists in both directions.
        graph[src].append((dst, d))
        graph[dst].append((src, d))

    return graph, coords


def dijkstra(graph, start, goal):
    """Classic Dijkstra shortest path between `start` and `goal`.

    Returns (path, total_distance) where path is a list of airport codes
    (empty list if no route exists) and total_distance is a float in km.
    Distances are rounded for display purposes at the API layer, not here,
    so that comparisons stay exact.
    """
    if start not in graph or goal not in graph:
        return [], 0.0
    if start == goal:
        return [start], 0.0

    # Best known distance from start to each node.
    dist = {start: 0.0}
    # Predecessor map for path reconstruction.
    prev = {}
    # Min-heap of (tentative_distance, node); start is free.
    heap = [(0.0, start)]
    visited = set()

    while heap:
        d, node = heapq.heappop(heap)
        if node in visited:
            continue  # Stale queue entry; the node is already finalised.
        visited.add(node)

        if node == goal:
            break  # Goal finalised: the shortest distance is settled.

        for neighbour, weight in graph.get(node, ()):
            if neighbour in visited:
                continue
            new_dist = d + weight
            # Relaxation: found a shorter way to reach the neighbour.
            if new_dist < dist.get(neighbour, float("inf")):
                dist[neighbour] = new_dist
                prev[neighbour] = node
                heapq.heappush(heap, (new_dist, neighbour))

    if goal not in visited:
        return [], 0.0  # Unreachable.

    # Reconstruct the path by walking predecessors backwards from goal.
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    return path, dist[goal]


def k_shortest_paths(graph, start, goal, k=3):
    """Yen's algorithm: return up to `k` loop-free paths, shortest first.

    Step 1: run Dijkstra to get the shortest path (A[0]).
    Step 2: for each candidate path, spur at every node along it -- remove
            the edge that continues the previously found route from the
            spur node, re-run Dijkstra on the remainder of the route,
            then add the result to a candidate pool.
    Step 3: pick the cheapest unseen candidate as the next alternative
            and repeat until we have `k` paths or candidates run out.

    Returns a list of (path, total_distance_km) tuples, best first.
    """
    first_path, first_dist = dijkstra(graph, start, goal)
    if not first_path:
        return []

    accepted = [(first_path, first_dist)]
    # Candidates: dict of (tuple(path), total_distance).
    candidates = {}

    for _ in range(k - 1):
        if not accepted:
            break
        last_path = accepted[-1][0]

        # Spur at every node except the last one on the previously
        # accepted path.
        for i, spur_node in enumerate(last_path[:-1]):
            root = tuple(last_path[: i + 1])

            # 1. Remove the edge used by every accepted path that shares
            #    this root, so Dijkstra is forced to find a new branch.
            removed_edges = []
            for path, _ in accepted:
                if tuple(path[: i + 1]) == root and i + 1 < len(path):
                    u, v = path[i], path[i + 1]
                    removed_edges.append((u, v))

            pruned = {n: list(edges) for n, edges in graph.items()}
            for u, v in removed_edges:
                pruned[u] = [(n, w) for n, w in pruned.get(u, []) if n != v]
                pruned[v] = [(n, w) for n, w in pruned.get(v, []) if n != u]

            # 2. Find the shortest path from the spur node to the goal
            #    in the pruned graph, then splice it onto the root.
            tail, tail_dist = dijkstra(pruned, spur_node, goal)
            if not tail:
                continue
            spur_path = list(root[:-1]) + tail
            # Root legs are still valid in the real graph; only the tail
            # was computed on the pruned graph.
            total = _path_cost(graph, spur_path) if len(spur_path) <= 1 \
                else _path_cost(graph, root) + tail_dist

            # 3. Keep the candidate only if it is loop-free and unseen.
            key = tuple(spur_path)
            if len(set(spur_path)) == len(spur_path) and key not in candidates:
                candidates[key] = total

        if not candidates:
            break

        # Promote the cheapest unseen candidate.
        best = min(candidates, key=candidates.get)
        accepted.append((list(best), candidates[best]))
        del candidates[best]

    return accepted


def _path_cost(graph, path):
    """Total weight of an explicit path through `graph` (0 if broken)."""
    total = 0.0
    for u, v in zip(path[:-1], path[1:]):
        weights = [w for n, w in graph.get(u, ()) if n == v]
        if not weights:
            return float("inf")  # Edge no longer exists.
        total += weights[0]
    return total
