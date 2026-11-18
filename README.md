# RouteX — Smart Flight Path Planning System ✈️

A complete, hackathon-ready web application that finds the **shortest flight
path** between airports using **Dijkstra's shortest path algorithm** over a
demo airport network, with an interactive **Leaflet.js / OpenStreetMap** map.

> **Transparency note:** This is a demo/educational system. Airport
> coordinates are realistic reference values. Connections are labelled
> **real** when they correspond to scheduled city-pair services that airlines
> have operated and **illustrative** when they exist purely to demonstrate
> the algorithm. RouteX does **not** provide live airline schedules,
> timetables, real-time flight availability, or booking.

---

## ✨ Features

| # | Feature |
|---|---------|
| 1 | Premium responsive dark-navy / electric-blue dashboard with collapsible sidebar and mobile drawer |
| 2 | Source & destination airport selection with searchable dropdowns (keyboard accessible) |
| 3 | Search & filter the airport directory by country or free text |
| 4 | Shortest flight path via **Dijkstra's algorithm** (binary-heap priority queue) |
| 5 | Four headline metrics: total distance, estimated duration, flight legs and stopovers |
| 6 | Vertical journey timeline with per-leg distance, flight time, connection allowance and real/illustrative labels |
| 7 | Interactive **Leaflet** map with airport markers, route glow, popups and automatic fit-to-route |
| 8 | Alternative routes via **Yen's k-shortest paths** (select one to preview it on the map) |
| 9 | Airport names, IATA codes, cities, countries and coordinates |
| 10 | Loading skeletons, empty states, inline error banners and toasts |
| 11 | **Reset** clears selections, results and map; **Swap** reverses the pair |
| 12 | Flight Analytics page computed live from the dataset: composition, top hubs, network extremes |
| 13 | How It Works page with SVG diagrams and the exact Haversine formula |
| 14 | About page with an explicit real-vs-illustrative data-transparency statement |
| 15 | Sample network with Pakistani airports: Karachi (KHI), Lahore (LHE), Islamabad (ISB), Multan (MUX), Peshawar (PEW), Quetta (UET), plus Faisalabad, Sialkot, D.I. Khan, Turbat, Gilgit, Skardu and international hubs |

## 🧠 Algorithms

- **Dijkstra** (`algorithms/dijkstra.py`): the airport network is an
  undirected graph; edge weights are great-circle distances. A min-heap
  priority queue finds the minimum-distance path.
- **Yen's algorithm** (`algorithms/dijkstra.py`): derives loop-free
  alternative paths by spur-node edge removal, sorted by total distance.
- **Haversine** (`algorithms/distance.py`): great-circle distance between
  two lat/lon points on the Earth's surface.

## 🗂 Project structure

```
flight-path-planner/
├── app.py                     # Flask backend + JSON API
├── requirements.txt           # Python dependencies
├── README.md
├── data/
│   └── airports.json          # Airport dataset + demo connections
├── algorithms/
│   ├── __init__.py
│   ├── dijkstra.py            # Dijkstra + Yen's k-shortest paths
│   └── distance.py            # Haversine formula + duration estimates
├── templates/
│   └── index.html             # Dashboard (Jinja2 template)
└── static/
    ├── css/style.css          # Dark navy / sky-blue design system
    ├── js/script.js           # UI logic, safe DOM rendering, Leaflet map
    └── vendor/leaflet/        # Leaflet 1.9.4 bundled locally (no CDN needed)
```

## 🚀 Installation & running

### 1. Prerequisites
- **Python 3.10+** (developed and tested on 3.13)
- A modern browser. Map tiles load from OpenStreetMap; everything else
  (Leaflet, CSS, JS, fonts fallback) is served locally.

### 2. Install dependencies

```bash
cd flight-path-planner
python -m venv venv

# Windows (PowerShell)
venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Run the server

```bash
python app.py
```

Then open **http://127.0.0.1:5000** in your browser.

> On Windows PowerShell, script activation may be blocked — if so run
> `Set-ExecutionPolicy -Scope Process RemoteSigned` first, or use
> `venv\Scripts\activate.bat` in cmd.

## 🧪 Try it

1. Open **Route Planner**, type **"Karachi"** in *From*, **"London"** in *To*
   (or use IATA codes).
2. Press **Find Best Route** — the KPI cards, journey timeline and ranked
   alternatives appear.
3. Click any alternative route to preview it on the map; use **Shortest route**
   to switch back.
4. Use **Swap** to reverse the pair, **Reset** to clear everything.
5. Visit **Airports** to search the directory, **Flight Analytics** for network
   metrics, and **How It Works** for the graph/maths walkthrough.

## 🔌 API reference

| Method | Endpoint | Body / Response |
|--------|----------|-----------------|
| `GET` | `/api/airports` | `{ airports: [...], connections: [...], disclaimer }` |
| `POST` | `/api/route` | Body `{ "source": "KHI", "destination": "LHR" }` → `{ best, alternatives[], direct_distance_km, disclaimer }` |
| `GET` | `/api/analytics` | Aggregates computed from `data/airports.json`: airport/link counts, composition, hubs, density, longest/shortest link |

Route legs include `flight_minutes` and routes include `layover_minutes` so the
timeline can show per-leg flight time and connection allowance. All fields are
additive — the original route shape is unchanged.

Validation: unknown codes, identical endpoints and non-string input return
`400` with a descriptive error; unreachable pairs return `404`.

## 🔒 Engineering notes

- **Safe DOM rendering** — all dynamic data is inserted with
  `textContent`; no `innerHTML` with user/network data.
- **Validated API input** — request bodies are type-checked and airport
  codes are verified against the dataset before routing.
- **No external data calls** — the network is a static demo dataset; only
  OpenStreetMap raster tiles are requested by the browser. Inter is loaded from
  Google Fonts when available, with a system-font fallback.
- **Dataset-driven analytics** — `/api/analytics` recomputes counts, density,
  hubs and network extremes from `data/airports.json` on every request; nothing
  is hardcoded in the frontend.
- **Accessibility** — 4.5:1 text contrast, visible focus rings,
  `aria-live` regions, keyboard-navigable dropdowns (arrow keys, Enter,
  Escape), skip link, and `prefers-reduced-motion` respected.

## 📄 License

Educational/hackathon demo — map data and tiles © OpenStreetMap contributors.
Leaflet is bundled under its BSD-2-Clause licence.
