"""Smart Flight Path Planning System - Flask backend.

Serves the dashboard UI and a small JSON API:
  GET  /                 -> the single-page dashboard
  GET  /api/airports     -> all airports + the demo connection network
  GET  /api/analytics    -> aggregate statistics from the demo dataset
  POST /api/route        -> shortest + alternative routes for a pair

The backend never talks to any external service: the airport network is
a static demo dataset (data/airports.json) and all computation is local
(Dijkstra over great-circle distances).
"""

import json
import os

from flask import Flask, jsonify, render_template, request

from algorithms.dijkstra import build_graph, dijkstra, k_shortest_paths
from algorithms.distance import (
    haversine,
    point_to_point_minutes,
    layover_minutes,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "airports.json")

app = Flask(__name__)


def load_network():
    """Load and validate the airport dataset once at startup."""
    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    airports = data["airports"]
    codes = {a["code"] for a in airports}

    # Drop connections that reference unknown airports (defensive).
    clean = [
        c for c in data["connections"]
        if c.get("from") in codes and c.get("to") in codes
        and c.get("from") != c.get("to")
    ]
    graph, coords = build_graph(airports, clean)
    return airports, clean, graph, coords, data.get("disclaimer", "")


with app.app_context():
    AIRPORTS, CONNECTIONS, GRAPH, COORDS, DISCLAIMER = load_network()
AIRPORT_BY_CODE = {a["code"]: a for a in AIRPORTS}


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Render the dashboard (index.html pulls everything else in)."""
    return render_template("index.html")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/airports")
def api_airports():
    """Return the airport list and the demo connection network."""
    return jsonify({
        "airports": AIRPORTS,
        "connections": CONNECTIONS,
        "disclaimer": DISCLAIMER,
    })


@app.get("/api/analytics")
def api_analytics():
    """Aggregate network statistics computed from the demo dataset.

    Everything here derives from the same airports/connections data that
    powers the planner; nothing is fabricated or fetched at runtime.
    """
    # Deduplicate undirected pairs (a pair may be listed twice defensively).
    pairs = {}
    for c in CONNECTIONS:
        key = frozenset((c["from"], c["to"]))
        entry = pairs.get(key)
        if entry is None:
            pairs[key] = {"from": c["from"], "to": c["to"], "type": c["type"]}
        elif c["type"] == "real":
            entry["type"] = "real"  # "real" wins over "illustrative".

    real = sum(1 for e in pairs.values() if e["type"] == "real")
    illustrative = len(pairs) - real

    # Degree = number of distinct links touching an airport.
    degree = {a["code"]: 0 for a in AIRPORTS}
    for key in pairs:
        u, v = tuple(key)
        degree[u] += 1
        degree[v] += 1

    hubs = sorted(
        ({"code": a["code"], "city": a["city"], "name": a["name"],
          "country": a["country"], "connections": degree[a["code"]]}
         for a in AIRPORTS),
        key=lambda h: (-h["connections"], h["code"]),
    )[:6]

    # Length of every distinct link, measured with the same Haversine
    # function used by the route planner.
    edge_lengths = []
    for key, edge in pairs.items():
        u, v = tuple(key)
        lat1, lon1 = COORDS[u]
        lat2, lon2 = COORDS[v]
        edge_lengths.append({
            "from": edge["from"], "to": edge["to"],
            "km": round(haversine(lat1, lon1, lat2, lon2), 1),
            "type": edge["type"],
        })

    longest = max(edge_lengths, key=lambda e: e["km"])
    shortest = min(edge_lengths, key=lambda e: e["km"])

    airport_count = len(AIRPORTS)
    link_count = len(pairs)
    # Share of all possible undirected pairs that exist in the network.
    density = (2 * link_count) / (airport_count * (airport_count - 1)) * 100

    countries = sorted({a["country"] for a in AIRPORTS})
    pakistan = sum(1 for a in AIRPORTS if a["country"] == "Pakistan")

    return jsonify({
        "airport_count": airport_count,
        "link_count": link_count,
        "real_links": real,
        "illustrative_links": illustrative,
        "country_count": len(countries),
        "countries": countries,
        "pakistan_airports": pakistan,
        "international_airports": airport_count - pakistan,
        "network_density_pct": round(density, 1),
        "average_links": round(2 * link_count / airport_count, 1),
        "total_link_km": round(sum(e["km"] for e in edge_lengths), 1),
        "hubs": hubs,
        "longest": longest,
        "shortest": shortest,
        "disclaimer": DISCLAIMER,
    })


def _leg_details(path):
    """Split a path into per-leg dicts with distance and flight type."""
    # Look up whether each connection is a real scheduled route or an
    # illustrative demo edge, so the UI can label it honestly.
    edge_types = {}
    for c in CONNECTIONS:
        key = frozenset((c["from"], c["to"]))
        # "real" wins if a pair appears twice for some reason.
        if key not in edge_types or c["type"] == "real":
            edge_types[key] = c["type"]

    lat1, lon1 = COORDS[path[0]]
    legs = []
    for u, v in zip(path[:-1], path[1:]):
        lat2, lon2 = COORDS[v]
        d = haversine(lat1, lon1, lat2, lon2)
        legs.append({
            "from": u,
            "to": v,
            "distance_km": round(d, 1),
            "flight_minutes": int(round(point_to_point_minutes(d))),
            "type": edge_types.get(frozenset((u, v)), "illustrative"),
        })
        lat1, lon1 = lat2, lon2
    return legs


def _route_payload(path):
    """Build the full result card payload for one path."""
    legs = _leg_details(path)
    total = round(sum(leg["distance_km"] for leg in legs), 1)

    # Duration estimate: airborne time per leg + 1h connection per stop.
    minutes = sum(point_to_point_minutes(l["distance_km"]) for l in legs)
    if len(legs) > 1:
        minutes += layover_minutes() * (len(legs) - 1)
    hours = int(minutes // 60)
    mins = int(round(minutes % 60))

    return {
        "path": path,
        "stops": [AIRPORT_BY_CODE[c] for c in path],
        "legs": legs,
        "total_distance_km": total,
        "estimated_duration": {"hours": hours, "minutes": mins,
                               "total_minutes": int(round(minutes))},
        "layover_minutes": int(round(layover_minutes())) if len(legs) > 1 else 0,
        "flight_count": len(legs),
        "real_edges": sum(1 for l in legs if l["type"] == "real"),
        "illustrative_edges": sum(1 for l in legs if l["type"] == "illustrative"),
    }


def _validate_codes(payload):
    """Validate the JSON request body; return (source, dest) or an error."""
    if not isinstance(payload, dict):
        return None, None, ("Request body must be JSON", 400)

    source = payload.get("source")
    destination = payload.get("destination")

    if not isinstance(source, str) or not isinstance(destination, str):
        return None, None, ("'source' and 'destination' must be strings", 400)

    source = source.strip().upper()
    destination = destination.strip().upper()

    if source == destination:
        return None, None, ("Source and destination must be different airports", 400)
    if source not in AIRPORT_BY_CODE:
        return None, None, (f"Unknown source airport '{source}'", 400)
    if destination not in AIRPORT_BY_CODE:
        return None, None, (f"Unknown destination airport '{destination}'", 400)

    return source, destination, None


@app.post("/api/route")
def api_route():
    """Compute the shortest path and alternatives between two airports."""
    payload = request.get_json(silent=True)
    source, destination, error = _validate_codes(payload)
    if error:
        message, status = error
        return jsonify({"error": message}), status

    graph = dict(GRAPH)

    # Shortest route (Dijkstra).
    path, _dist = dijkstra(graph, source, destination)
    if not path:
        return jsonify({
            "error": f"No route found between {source} and {destination} "
                     "in the demo network.",
        }), 404

    best = _route_payload(path)

    # Alternatives (Yen's k-shortest, loop-free), skipping duplicates.
    alternatives = []
    for alt_path, _alt_dist in k_shortest_paths(graph, source, destination, k=4):
        if alt_path == path or len(alternatives) >= 3:
            continue
        alternatives.append(_route_payload(alt_path))

    # Straight-line distance for comparison ("as the crow flies").
    lat1, lon1 = COORDS[source]
    lat2, lon2 = COORDS[destination]
    direct = round(haversine(lat1, lon1, lat2, lon2), 1)

    return jsonify({
        "best": best,
        "alternatives": alternatives,
        "direct_distance_km": direct,
        "disclaimer": DISCLAIMER,
    })


@app.errorhandler(404)
def not_found(_e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(_e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
