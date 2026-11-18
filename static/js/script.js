/* ============================================================================
   RouteX — Flight Intelligence Dashboard (frontend)
   - Hash router across five pages
   - Collapsible sidebar / mobile drawer
   - Airport comboboxes, route planner, alternatives, Leaflet map
   - Airports directory and flight analytics
   All dynamic data is rendered with safe DOM APIs (textContent), never with
   innerHTML, and all backend results come from the real Flask API.
   ========================================================================== */
"use strict";

/* ------------------------------- Helpers --------------------------------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const SVGNS = "http://www.w3.org/2000/svg";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name, className = "icon") {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVGNS, "use");
  use.setAttribute("href", "#i-" + name);
  svg.appendChild(use);
  return svg;
}

function codeChip(code, variant = "neutral") {
  return el("span", `code-chip ${variant}`, code);
}

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
function formatKm(value) {
  return numberFmt.format(Number(value) || 0);
}

function formatDuration(duration) {
  const minutes = String(duration.minutes).padStart(2, "0");
  return `${duration.hours}h ${minutes}m`;
}

function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = Math.round(total % 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

function formatCoords(airport) {
  const lat = Math.abs(airport.lat).toFixed(4);
  const lon = Math.abs(airport.lon).toFixed(4);
  return `${lat}° ${airport.lat >= 0 ? "N" : "S"}, ${lon}° ${airport.lon >= 0 ? "E" : "W"}`;
}

function tagEl(type) {
  const real = type === "real";
  return el("span", `tag ${real ? "tag-real" : "tag-illus"}`, real ? "Real route" : "Illustrative");
}

/* -------------------------------- Toasts ---------------------------------- */
function toast(message, type = "success") {
  const stack = $("#toast-stack");
  if (!stack) return;
  const node = el("div", `toast ${type === "error" ? "error" : ""}`);
  node.append(icon(type === "error" ? "alert" : "check-circle"), el("span", null, message));
  stack.appendChild(node);
  window.setTimeout(() => node.remove(), 4000);
}

/* ---------------------------------- API ----------------------------------- */
async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch (_err) {
    data = null;
  }
  if (!response.ok) {
    const message = (data && data.error) || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

const api = {
  airports: () => fetchJSON("/api/airports"),
  analytics: () => fetchJSON("/api/analytics"),
  route: (source, destination) =>
    fetchJSON("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, destination }),
    }),
};

/* --------------------------------- State ---------------------------------- */
const state = {
  airports: [],
  connections: [],
  byCode: new Map(),
  degrees: new Map(),
  uniqueLinkCount: 0,
  disclaimer: "",
  source: null,
  destination: null,
  result: null,
  activeIndex: 0,
  analytics: null,
  analyticsLoading: false,
  filters: { search: "", group: "all" },
  networkLoaded: false,
};

/* --------------------------------- Router --------------------------------- */
const PAGES = {
  planner: {
    title: "Route Planner",
    subtitle: "Build the shortest path between any two airports in the demo network.",
    crumb: "Route Planner",
  },
  airports: {
    title: "Airports",
    subtitle: "Every airport in the network, with coordinates and connectivity.",
    crumb: "Airports",
  },
  analytics: {
    title: "Flight Analytics",
    subtitle: "Network-level metrics computed live from the demo dataset.",
    crumb: "Flight Analytics",
  },
  how: {
    title: "How It Works",
    subtitle: "The graph model, Dijkstra search and Haversine maths behind every route.",
    crumb: "How It Works",
  },
  about: {
    title: "About Project",
    subtitle: "What RouteX is, what it uses, and what it deliberately does not claim.",
    crumb: "About Project",
  },
};

let routerReady = false;

const PAGE_ALIASES = { "how-it-works": "how" };

function currentPage() {
  const raw = window.location.hash.replace(/^#/, "") || "planner";
  const key = PAGE_ALIASES[raw] || raw;
  return PAGES[key] ? key : "planner";
}

function navigate() {
  const page = currentPage();
  const meta = PAGES[page];

  $$(".page").forEach((section) => {
    section.hidden = section.dataset.page !== page;
  });
  $$(".nav-item").forEach((item) => {
    if (item.dataset.page === page) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  $("#page-title").textContent = meta.title;
  $("#page-subtitle").textContent = meta.subtitle;
  $("#crumb-current").textContent = meta.crumb;
  document.title = `${meta.title} — RouteX`;

  if (page === "analytics") loadAnalytics();
  if (page === "planner" && map) {
    window.requestAnimationFrame(() => map.invalidateSize());
  }

  closeDrawer();
  if (routerReady) window.scrollTo({ top: 0, behavior: "auto" });
  routerReady = true;
}

function initRouter() {
  window.addEventListener("hashchange", navigate);
}

/* -------------------------------- Sidebar --------------------------------- */
function setDrawer(open) {
  const app = $("#app");
  const backdrop = $("#sidebar-backdrop");
  const menuBtn = $("#menu-btn");
  app.classList.toggle("drawer-open", open);
  backdrop.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  document.body.style.overflow = open ? "hidden" : "";
}

function closeDrawer() {
  if ($("#app").classList.contains("drawer-open")) setDrawer(false);
}

function syncCollapseUI() {
  const collapsed = $("#app").classList.contains("sidebar-collapsed");
  const btn = $("#collapse-btn");
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  $$(".nav-item").forEach((item) => {
    if (collapsed) item.title = item.dataset.label;
    else item.removeAttribute("title");
  });
}

function initSidebar() {
  const app = $("#app");
  const stored = window.localStorage.getItem("routex:collapsed");
  if (stored === "1") app.classList.add("sidebar-collapsed");
  syncCollapseUI();

  $("#collapse-btn").addEventListener("click", () => {
    app.classList.toggle("sidebar-collapsed");
    window.localStorage.setItem(
      "routex:collapsed",
      app.classList.contains("sidebar-collapsed") ? "1" : "0"
    );
    syncCollapseUI();
    window.setTimeout(() => {
      if (map) map.invalidateSize();
    }, 260);
  });

  $("#menu-btn").addEventListener("click", () => {
    setDrawer(!app.classList.contains("drawer-open"));
  });
  $("#sidebar-backdrop").addEventListener("click", () => setDrawer(false));
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => setDrawer(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setDrawer(false);
  });
}

function initSkipLink() {
  const link = $(".skip-link");
  const main = $("#content");
  if (!link || !main) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    main.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function setApiStatus(ok) {
  const pill = $("#api-status");
  pill.classList.toggle("offline", !ok);
  const text = $(".status-pill-text", pill);
  if (text) text.textContent = ok ? "API connected" : "API offline";
  pill.title = ok
    ? "Connected to the local Flask API"
    : "The Flask API is not responding";
  $("#side-status-text").textContent = ok ? "Network online" : "Network offline";
  $("#net-card").classList.toggle("is-offline", !ok);
}

/* ------------------------------ Comboboxes -------------------------------- */
function renderSelection(role) {
  const isSource = role === "source";
  const code = isSource ? state.source : state.destination;
  const card = isSource ? $("#source-card") : $("#dest-card");
  const box = isSource ? $("#source-selected") : $("#dest-selected");
  const hint = isSource ? $("#source-hint") : $("#dest-hint");
  const clearBtn = isSource ? $("#source-clear") : $("#dest-clear");

  if (!code) {
    box.hidden = true;
    box.replaceChildren();
    card.classList.remove("has-selection");
    hint.hidden = false;
    clearBtn.hidden = true;
    return;
  }

  const airport = state.byCode.get(code);
  if (!airport) return;

  box.replaceChildren();
  box.append(
    codeChip(airport.code, isSource ? "src" : "dst"),
    (() => {
      const main = el("div", "apt-sel-main");
      main.append(
        el("strong", null, airport.name),
        el("span", null, `${airport.city}, ${airport.country}`)
      );
      return main;
    })(),
    el("span", "apt-sel-coords", formatCoords(airport))
  );
  box.hidden = false;
  card.classList.add("has-selection");
  hint.hidden = true;
  clearBtn.hidden = false;
}

let plannerErrorKind = null;

function showPlannerError(message, kind = "generic") {
  plannerErrorKind = kind;
  $("#planner-error-text").textContent = message;
  $("#planner-error").hidden = false;
}

function clearPlannerError(kind) {
  if (kind && plannerErrorKind !== kind) return;
  plannerErrorKind = null;
  $("#planner-error").hidden = true;
  $("#planner-error-text").textContent = "";
}

function refreshActions() {
  const same =
    Boolean(state.source) &&
    Boolean(state.destination) &&
    state.source === state.destination;
  const ready = Boolean(state.source && state.destination && !same);

  $("#find-btn").disabled = !ready;
  $("#reset-btn").disabled = !state.source && !state.destination && !state.result;

  if (same) {
    showPlannerError("Departure and arrival airports must be different.", "same");
  } else if (plannerErrorKind === "same") {
    clearPlannerError("same");
  }
}

function setAirport(role, code) {
  if (role === "source") state.source = code;
  else state.destination = code;
  const airport = state.byCode.get(code);
  if (!airport) return;
  const input = role === "source" ? $("#source-input") : $("#dest-input");
  input.value = `${airport.city} (${airport.code})`;
  renderSelection(role);
  refreshActions();
}

function setupCombobox(role) {
  const isSource = role === "source";
  const input = $(isSource ? "#source-input" : "#dest-input");
  const panel = $(isSource ? "#source-panel" : "#dest-panel");
  const clearBtn = $(isSource ? "#source-clear" : "#dest-clear");
  let activeIndex = -1;

  const selectedCode = () => (isSource ? state.source : state.destination);

  function open() {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  }

  function setActive(index) {
    const options = $$(".combo-option", panel);
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach((option, i) => option.classList.toggle("active", i === activeIndex));
    const option = options[activeIndex];
    input.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  }

  function choose(code) {
    setAirport(role, code);
    close();
  }

  function renderOptions(query) {
    panel.replaceChildren();

    if (!state.airports.length) {
      const loading = el("div", "combo-empty");
      loading.append(icon("globe"), el("span", null, "Loading airport network…"));
      panel.appendChild(loading);
      return;
    }

    const q = query.trim().toLowerCase();
    const matches = state.airports
      .filter(
        (airport) =>
          !q ||
          airport.code.toLowerCase().includes(q) ||
          airport.city.toLowerCase().includes(q) ||
          airport.name.toLowerCase().includes(q) ||
          airport.country.toLowerCase().includes(q)
      )
      .slice(0, 60);

    if (!matches.length) {
      const empty = el("div", "combo-empty");
      empty.append(icon("search"), el("span", null, "No airports match your search."));
      panel.appendChild(empty);
      return;
    }

    matches.forEach((airport, index) => {
      const option = el("button", "combo-option");
      option.type = "button";
      option.id = `${panel.id}-opt-${index}`;
      option.setAttribute("role", "option");
      option.dataset.code = airport.code;

      const main = el("div", "combo-main");
      main.append(
        el("div", "combo-name", airport.name),
        el("div", "combo-sub", `${airport.city}, ${airport.country}`)
      );
      option.append(
        codeChip(airport.code, "neutral"),
        main,
        el("span", "combo-coords", `${airport.lat.toFixed(2)}, ${airport.lon.toFixed(2)}`)
      );
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(airport.code));
      panel.appendChild(option);
    });
  }

  input.addEventListener("input", () => {
    if (isSource) state.source = null;
    else state.destination = null;
    renderSelection(role);
    refreshActions();
    open();
    renderOptions(input.value);
  });

  input.addEventListener("focus", () => {
    if (!selectedCode()) {
      renderOptions("");
      open();
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!panel.contains(document.activeElement)) close();
    }, 130);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (panel.hidden) {
        renderOptions(input.value);
        open();
        activeIndex = -1;
      }
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (panel.hidden) {
        renderOptions(input.value);
        open();
        activeIndex = 0;
      }
      setActive(activeIndex - 1);
    } else if (event.key === "Enter") {
      if (panel.hidden) return;
      event.preventDefault();
      const option =
        panel.querySelector(".combo-option.active") ||
        panel.querySelector(".combo-option");
      if (option) choose(option.dataset.code);
    } else if (event.key === "Escape") {
      close();
    } else if (event.key === "Tab") {
      close();
    }
  });

  clearBtn.addEventListener("click", () => {
    if (isSource) state.source = null;
    else state.destination = null;
    input.value = "";
    renderSelection(role);
    refreshActions();
    renderOptions("");
    open();
    input.focus();
  });
}

function swapAirports() {
  if (!state.source && !state.destination) return;
  const source = state.source;
  const destination = state.destination;

  state.source = destination;
  state.destination = source;

  $("#source-input").value = destination
    ? `${state.byCode.get(destination).city} (${destination})`
    : "";
  $("#dest-input").value = source
    ? `${state.byCode.get(source).city} (${source})`
    : "";

  renderSelection("source");
  renderSelection("destination");
  refreshActions();

  const card = $("#source-card");
  card.classList.add("flash");
  window.setTimeout(() => card.classList.remove("flash"), 800);
  toast("Departure and arrival swapped");
}

/* ------------------------------- Map layer -------------------------------- */
let map = null;
let networkLayer = null;
let routeLayer = null;

function buildChipElement(code, variant, compact) {
  return el("div", `ap-chip ${variant}${compact ? " compact" : ""}`, code);
}

function buildAirportPopup(airport) {
  const root = el("div");
  const title = el("div", "popup-title");
  title.append(codeChip(airport.code, "neutral"), el("div", "popup-name", airport.name));
  root.append(title);
  root.append(el("div", "popup-sub", `${airport.city}, ${airport.country}`));
  root.append(el("div", "popup-coords", formatCoords(airport)));

  const actions = el("div", "popup-actions");
  const flyFrom = el("button", "popup-btn", "Fly from");
  flyFrom.type = "button";
  flyFrom.addEventListener("click", () => {
    setAirport("source", airport.code);
    map.closePopup();
    toast(`${airport.code} set as departure airport`, "info");
  });
  const flyTo = el("button", "popup-btn", "Fly to");
  flyTo.type = "button";
  flyTo.addEventListener("click", () => {
    setAirport("destination", airport.code);
    map.closePopup();
    toast(`${airport.code} set as arrival airport`, "info");
  });
  actions.append(flyFrom, flyTo);
  root.append(actions);
  return root;
}

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    minZoom: 2,
    worldCopyJump: true,
  }).setView([30.2, 68.8], 4);

  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 120 }).addTo(map);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  networkLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function drawNetwork() {
  if (!map || !networkLayer) return;
  networkLayer.clearLayers();
  state.airports.forEach((airport) => {
    const marker = L.circleMarker([airport.lat, airport.lon], {
      radius: 4,
      color: "#7ba7d8",
      weight: 1.4,
      fillColor: "#1b3b60",
      fillOpacity: 1,
      opacity: 0.85,
    });
    marker.bindTooltip(`${airport.code} · ${airport.city}`, {
      direction: "top",
      offset: [0, -6],
    });
    marker.bindPopup(buildAirportPopup(airport));
    marker.addTo(networkLayer);
  });
}

function drawRoutes() {
  if (!map || !routeLayer || !state.result) return;
  routeLayer.clearLayers();

  const list = routeEntries();
  const activeIdx = Math.min(state.activeIndex, list.length - 1);

  // Faint context lines for every route that is not currently active.
  list.forEach((entry, index) => {
    if (index === activeIdx) return;
    const latlngs = entry.route.stops.map((a) => [a.lat, a.lon]);
    L.polyline(latlngs, {
      color: entry.isBest ? "#38bdf8" : "#fbbf24",
      weight: 2,
      opacity: entry.isBest ? 0.32 : 0.2,
      dashArray: "4 7",
      interactive: false,
    }).addTo(routeLayer);
  });

  const active = list[activeIdx];
  const route = active.route;
  const latlngs = route.stops.map((a) => [a.lat, a.lon]);
  const color = active.isBest ? "#38bdf8" : "#fbbf24";
  const compactMarkers = window.matchMedia("(max-width: 640px)").matches;

  L.polyline(latlngs, {
    color,
    weight: 14,
    opacity: 0.12,
    lineCap: "round",
    interactive: false,
  }).addTo(routeLayer);

  const mainLine = L.polyline(latlngs, {
    color,
    weight: 3.5,
    opacity: 1,
    lineCap: "round",
  }).addTo(routeLayer);
  mainLine.bindTooltip(`${route.path.join(" → ")} · ${formatKm(route.total_distance_km)} km`, {
    sticky: true,
  });
  mainLine.bindPopup(buildRoutePopup(route, active.isBest));

  route.stops.forEach((airport, index) => {
    const isFirst = index === 0;
    const isLast = index === route.stops.length - 1;
    const variant = isFirst ? "dep" : isLast ? "arr" : "stop";
    const width = compactMarkers ? 32 : isFirst || isLast ? 46 : 42;
    const marker = L.marker([airport.lat, airport.lon], {
      icon: L.divIcon({
        className: "map-dot-wrap",
        html: buildChipElement(airport.code, variant, compactMarkers),
        iconSize: [width, compactMarkers ? 20 : 24],
        iconAnchor: [width / 2, compactMarkers ? 10 : 12],
      }),
      zIndexOffset: isFirst || isLast ? 400 : 200,
      title: `${airport.code} — ${airport.name}`,
    });
    const roleLabel = isFirst ? "Departure" : isLast ? "Arrival" : "Stopover";
    marker.bindTooltip(`${airport.code} · ${roleLabel}`, {
      direction: "top",
      offset: [0, compactMarkers ? -10 : -12],
    });
    marker.bindPopup(buildAirportPopup(airport));
    marker.addTo(routeLayer);
  });

  fitRouteMap();
}

function buildRoutePopup(route, isBest) {
  const root = el("div");
  root.append(el("div", "popup-name", isBest ? "Shortest route" : "Alternative route"));
  root.append(el("div", "popup-sub", route.path.join(" → ")));
  root.append(
    el(
      "div",
      "popup-leg",
      `${formatKm(route.total_distance_km)} km · ${formatDuration(route.estimated_duration)} · ${route.flight_count} ${
        route.flight_count === 1 ? "flight" : "flights"
      }`
    )
  );
  return root;
}

function fitRouteMap() {
  if (!map || !state.result) return;
  const list = routeEntries();
  const entry = list[Math.min(state.activeIndex, list.length - 1)];
  const latlngs = entry.route.stops.map((a) => [a.lat, a.lon]);
  map.fitBounds(L.latLngBounds(latlngs), {
    padding: [46, 46],
    maxZoom: 6,
    animate: true,
  });
}

function clearRouteLayers() {
  if (routeLayer) routeLayer.clearLayers();
}

/* ------------------------------ Results view ------------------------------ */
function routeEntries() {
  if (!state.result) return [];
  return [
    { route: state.result.best, isBest: true },
    ...state.result.alternatives.map((route) => ({ route, isBest: false })),
  ];
}

function metricCard(iconName, label, value, unit, sub) {
  const card = el("div", "metric-card");
  const tile = el("div", "metric-icon");
  tile.appendChild(icon(iconName));
  card.append(tile, el("div", "metric-label", label));
  const valueRow = el("div", "metric-value", value);
  if (unit) valueRow.appendChild(el("span", "unit", unit));
  card.append(valueRow, el("div", "metric-sub", sub || ""));
  return card;
}

function showResultsSkeleton() {
  $("#results").hidden = false;
  $("#results-sub").textContent = "Computing the shortest path…";
  $("#route-pill").textContent = `${state.source} → ${state.destination}`;
  $("#back-best").hidden = true;
  $("#results-disclaimer").textContent = "";

  const body = $("#results-body");
  body.replaceChildren();

  const metrics = el("div", "sk-metrics");
  for (let i = 0; i < 4; i += 1) {
    const card = el("div", "sk-card");
    card.append(
      el("div", "skel skel-circle"),
      el("div", "skel skel-line sm"),
      el("div", "skel skel-line lg"),
      el("div", "skel skel-line sm")
    );
    metrics.appendChild(card);
  }

  const grid = el("div", "sk-grid");
  for (let i = 0; i < 2; i += 1) {
    const card = el("div", "sk-card");
    card.append(el("div", "skel skel-line"), el("div", "skel skel-block"));
    grid.appendChild(card);
  }

  body.append(metrics, grid);
}

function buildTimeline(route) {
  const panel = el("div", "panel timeline-panel");
  const head = el("div", "panel-head");
  const copy = el("div");
  const stopovers = Math.max(0, route.stops.length - 2);
  copy.append(
    el("h3", null, "Journey timeline"),
    el(
      "p",
      "section-sub",
      `${route.flight_count} ${route.flight_count === 1 ? "leg" : "legs"} · ${stopovers} ${
        stopovers === 1 ? "stopover" : "stopovers"
      }`
    )
  );
  head.appendChild(copy);
  panel.appendChild(head);

  const timeline = el("div", "timeline");

  route.stops.forEach((airport, index) => {
    const isFirst = index === 0;
    const isLast = index === route.stops.length - 1;

    const stop = el("div", "tl-stop");
    const rail = el("div", "tl-rail");
    rail.appendChild(el("span", `tl-dot ${isFirst ? "dep" : isLast ? "arr" : "stop"}`));

    const content = el("div", "tl-content");
    const top = el("div", "tl-top");
    top.append(
      codeChip(airport.code, isFirst ? "src" : isLast ? "dst" : "neutral"),
      el("span", "tl-role", isFirst ? "Departure" : isLast ? "Arrival" : "Stopover")
    );
    content.append(
      top,
      el("div", "tl-name", airport.name),
      el("div", "tl-sub", `${airport.city}, ${airport.country} · ${formatCoords(airport)}`)
    );
    stop.append(rail, content);
    timeline.appendChild(stop);

    if (!isLast) {
      const leg = route.legs[index];
      const legRow = el("div", "tl-leg");
      const legRail = el("div", "tl-rail");
      legRail.appendChild(el("span", "tl-line"));

      const legBody = el("div", "tl-leg-body");
      legBody.append(
        el("span", "tl-leg-dist", `${formatKm(leg.distance_km)} km`),
        el("span", "tl-leg-sep", "·"),
        el("span", null, `${formatMinutes(leg.flight_minutes)} flight`),
        tagEl(leg.type)
      );
      if (route.layover_minutes && index < route.stops.length - 2) {
        legBody.append(
          el("span", "tl-leg-sep", "·"),
          el("span", null, `${route.layover_minutes} min connection`)
        );
      }

      legRow.append(legRail, legBody);
      timeline.appendChild(legRow);
    }
  });

  panel.appendChild(timeline);
  return panel;
}

function buildAlternatives(list) {
  const panel = el("div", "panel alt-panel");
  const head = el("div", "panel-head");
  const copy = el("div");
  copy.append(
    el("h3", null, "Alternative routes"),
    el("p", "section-sub", "Select a route to preview it on the map.")
  );
  head.appendChild(copy);
  panel.appendChild(head);

  const wrap = el("div", "alt-list");
  const bestKm = list[0].route.total_distance_km;

  list.forEach((entry, index) => {
    const route = entry.route;
    const diff = Math.max(0, route.total_distance_km - bestKm);
    const stopovers = Math.max(0, route.stops.length - 2);

    const card = el("button", "alt-card");
    card.type = "button";
    const selected = index === state.activeIndex;
    if (selected) card.classList.add("selected");
    card.setAttribute("aria-pressed", String(selected));

    const top = el("div", "alt-top");
    top.append(
      el("span", `alt-badge${entry.isBest ? " best" : ""}`, entry.isBest ? "Shortest" : "Alternative"),
      el("span", "alt-delta", entry.isBest ? "Baseline" : `+${formatKm(diff)} km`)
    );

    const path = el("div", "alt-path");
    route.path.forEach((code, i) => {
      if (i) path.appendChild(icon("chevron-right", "icon alt-arrow"));
      path.appendChild(el("span", null, code));
    });

    const stats = el("div", "alt-stats");
    stats.append(
      el("span", null, `${formatKm(route.total_distance_km)} km`),
      el("span", null, formatDuration(route.estimated_duration)),
      el("span", null, `${stopovers} ${stopovers === 1 ? "stop" : "stops"}`),
      el("span", null, `${route.flight_count} ${route.flight_count === 1 ? "flight" : "flights"}`)
    );

    const cta = el("span", "alt-cta");
    cta.append(
      el("span", null, selected ? "Viewing" : "View route"),
      icon("arrow-up-right")
    );

    card.append(top, path, stats, cta);
    card.addEventListener("click", () => {
      state.activeIndex = index;
      renderResults();
      drawRoutes();
    });
    wrap.appendChild(card);
  });

  if (list.length === 1) {
    wrap.appendChild(
      el("p", "fine-print", "No alternative routes exist for this pair in the demo network.")
    );
  }

  panel.appendChild(wrap);
  return panel;
}

function renderResults() {
  const list = routeEntries();
  if (!list.length) return;
  const index = Math.min(state.activeIndex, list.length - 1);
  const entry = list[index];
  const route = entry.route;

  $("#results-sub").textContent = entry.isBest
    ? "Shortest path found by Dijkstra's algorithm."
    : "Alternative route — loop-free, ranked by total distance.";
  $("#route-pill").textContent = route.path.join(" → ");
  $("#back-best").hidden = entry.isBest;

  const stopovers = Math.max(0, route.stops.length - 2);
  const stopCodes = route.stops.slice(1, -1).map((a) => a.code).join(" · ");

  const body = $("#results-body");
  body.replaceChildren();

  const metrics = el("div", "metric-grid");
  metrics.append(
    metricCard(
      "route",
      "Total distance",
      formatKm(route.total_distance_km),
      "km",
      `${formatKm(state.result.direct_distance_km)} km direct`
    ),
    metricCard(
      "clock",
      "Estimated duration",
      formatDuration(route.estimated_duration),
      "",
      "Planning estimate, not a schedule"
    ),
    metricCard(
      "takeoff",
      "Flight legs",
      String(route.flight_count),
      route.flight_count === 1 ? "leg" : "legs",
      route.flight_count === 1 ? "Non-stop routing" : `${route.flight_count - 1} connections`
    ),
    metricCard(
      "map-pin",
      "Stopovers",
      String(stopovers),
      stopovers === 1 ? "stop" : "stops",
      stopovers ? stopCodes : "Non-stop routing"
    )
  );

  const grid = el("div", "results-grid");
  grid.append(buildTimeline(route), buildAlternatives(list));

  body.append(metrics, grid);
  $("#results-disclaimer").textContent = state.disclaimer || "";
}

async function findRoute() {
  if (!state.source || !state.destination || state.source === state.destination) return;
  clearPlannerError();

  const btn = $("#find-btn");
  const label = btn.querySelector("span");
  const useEl = btn.querySelector("use");
  const originalHref = useEl.getAttribute("href");

  btn.disabled = true;
  label.textContent = "Computing…";
  useEl.setAttribute("href", "#i-refresh");
  btn.querySelector("svg").classList.add("spin");

  showResultsSkeleton();

  try {
    const data = await api.route(state.source, state.destination);
    state.result = data;
    state.activeIndex = 0;
    setApiStatus(true);
    renderResults();
    drawRoutes();
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    state.result = null;
    $("#results").hidden = true;
    $("#results-body").replaceChildren();
    showPlannerError(error.message || "Could not compute a route.");
    toast(error.message || "Route request failed", "error");
  } finally {
    btn.disabled = false;
    label.textContent = "Find Best Route";
    useEl.setAttribute("href", originalHref);
    btn.querySelector("svg").classList.remove("spin");
    refreshActions();
  }
}

function resetPlanner() {
  state.source = null;
  state.destination = null;
  state.result = null;
  state.activeIndex = 0;

  $("#source-input").value = "";
  $("#dest-input").value = "";
  renderSelection("source");
  renderSelection("destination");

  $("#results").hidden = true;
  $("#results-body").replaceChildren();
  $("#results-sub").textContent = "Shortest path computed with Dijkstra's algorithm.";
  $("#route-pill").textContent = "";
  $("#results-disclaimer").textContent = "";
  $("#back-best").hidden = true;

  clearPlannerError();
  clearRouteLayers();
  if (map) map.setView([30.2, 68.8], 4);

  refreshActions();
  toast("Planner reset");
}

/* ------------------------------ Airports page ------------------------------ */
function miniStat(iconName, value, label) {
  const card = el("div", "mini-stat");
  const tile = el("div", "metric-icon");
  tile.appendChild(icon(iconName));
  const body = el("div", "mini-body");
  body.append(el("strong", null, String(value)), el("span", null, label));
  card.append(tile, body);
  return card;
}

function renderAirportStats() {
  const wrap = $("#airport-stats");
  if (!wrap) return;
  wrap.replaceChildren(
    miniStat("map-pin", state.airports.length, "Airports"),
    miniStat(
      "globe",
      state.airports.filter((a) => a.country === "Pakistan").length,
      "Pakistan"
    ),
    miniStat(
      "layers",
      state.airports.filter((a) => a.country !== "Pakistan").length,
      "International"
    ),
    miniStat("network", state.uniqueLinkCount, "Unique links")
  );
}

function renderAirportDirectory() {
  const body = $("#airport-list");
  if (!body) return;

  if (!state.airports.length) {
    body.replaceChildren();
    for (let i = 0; i < 6; i += 1) {
      const row = el("div", "airport-row");
      row.append(
        el("div", "skel skel-line"),
        el("div", "skel skel-line"),
        el("div", "skel skel-line"),
        el("div", "skel skel-line"),
        el("div", "skel skel-line")
      );
      body.appendChild(row);
    }
    return;
  }

  const q = state.filters.search.trim().toLowerCase();
  const group = state.filters.group;
  const list = state.airports
    .filter((airport) => {
      if (group === "pk" && airport.country !== "Pakistan") return false;
      if (group === "intl" && airport.country === "Pakistan") return false;
      if (!q) return true;
      return `${airport.code} ${airport.name} ${airport.city} ${airport.country}`
        .toLowerCase()
        .includes(q);
    })
    .sort(
      (a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city)
    );

  body.replaceChildren();
  $("#airport-empty").hidden = list.length > 0;

  list.forEach((airport) => {
    const row = el("div", "airport-row");

    const main = el("div", "airport-main");
    main.append(
      el("strong", null, airport.name),
      el("span", null, `${airport.city}, ${airport.country}`)
    );

    const links = el("span", "airport-links");
    links.append(icon("network"), el("span", null, String(state.degrees.get(airport.code) || 0)));

    row.append(
      codeChip(airport.code, "neutral"),
      main,
      el("span", "airport-country", airport.country),
      el("span", "airport-coords", formatCoords(airport)),
      links
    );
    body.appendChild(row);
  });
}

function initAirportsPage() {
  const search = $("#airport-search");
  if (!search) return;

  search.addEventListener("input", () => {
    state.filters.search = search.value;
    renderAirportDirectory();
  });

  $$(".seg-btn", $("#airport-filter")).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.group = btn.dataset.filter;
      $$(".seg-btn", $("#airport-filter")).forEach((other) => {
        const active = other === btn;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderAirportDirectory();
    });
  });

  $("#airport-empty-reset").addEventListener("click", () => {
    search.value = "";
    state.filters.search = "";
    state.filters.group = "all";
    $$(".seg-btn", $("#airport-filter")).forEach((btn) => {
      const active = btn.dataset.filter === "all";
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    renderAirportDirectory();
  });
}

/* -------------------------------- Analytics -------------------------------- */
function analyticsSkeleton() {
  const kpis = $("#analytics-kpis");
  kpis.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const card = el("div", "sk-card");
    card.append(
      el("div", "skel skel-circle"),
      el("div", "skel skel-line sm"),
      el("div", "skel skel-line lg")
    );
    kpis.appendChild(card);
  }
  ["composition-body", "hubs-body", "links-body"].forEach((id) => {
    const node = $("#" + id);
    if (!node) return;
    node.replaceChildren();
    node.append(el("div", "skel skel-block"));
  });
}

function analyticsError(message) {
  const kpis = $("#analytics-kpis");
  kpis.replaceChildren();
  ["composition-body", "hubs-body", "links-body"].forEach((id) => {
    const node = $("#" + id);
    if (!node) return;
    node.replaceChildren();
    const wrap = el("div", "empty-state");
    wrap.append(
      icon("alert", "icon"),
      el("h3", null, "Analytics unavailable"),
      el("p", null, message || "The Flask API did not respond.")
    );
    const retry = el("button", "btn btn-ghost btn-sm", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => {
      state.analytics = null;
      loadAnalytics();
    });
    wrap.appendChild(retry);
    node.appendChild(wrap);
  });
}

async function loadAnalytics() {
  if (state.analytics) {
    renderAnalytics();
    return;
  }
  if (state.analyticsLoading) return;
  state.analyticsLoading = true;
  analyticsSkeleton();
  try {
    state.analytics = await api.analytics();
    setApiStatus(true);
    renderAnalytics();
  } catch (error) {
    analyticsError(error.message);
    toast("Could not load analytics", "error");
  } finally {
    state.analyticsLoading = false;
  }
}

function renderAnalytics() {
  const data = state.analytics;
  if (!data) return;

  const kpis = $("#analytics-kpis");
  kpis.replaceChildren(
    metricCard(
      "map-pin",
      "Airports",
      String(data.airport_count),
      "",
      `Across ${data.country_count} countries`
    ),
    metricCard(
      "network",
      "Connections",
      String(data.link_count),
      "",
      `${data.real_links} real · ${data.illustrative_links} illustrative`
    ),
    metricCard(
      "gauge",
      "Network density",
      String(data.network_density_pct),
      "%",
      `${data.average_links} links per airport on average`
    ),
    metricCard(
      "route",
      "Total link distance",
      formatKm(data.total_link_km),
      "km",
      "Sum of every unique edge"
    )
  );

  // Composition donut
  const composition = $("#composition-body");
  composition.replaceChildren();
  const realShare = data.link_count ? (data.real_links / data.link_count) * 100 : 0;
  const donutWrap = el("div", "donut-wrap");
  const donut = el("div", "donut");
  donut.style.background = `conic-gradient(var(--success) 0 ${realShare}%, var(--warning) ${realShare}% 100%)`;
  const center = el("div", "donut-center");
  center.append(el("strong", null, String(data.link_count)), el("span", null, "links"));
  donut.appendChild(center);

  const legend = el("div", "donut-legend");
  const realRow = el("div", "legend-row");
  const realDot = el("span", "legend-dot real");
  realDot.setAttribute("aria-hidden", "true");
  realRow.append(
    realDot,
    (() => {
      const cell = el("span");
      cell.append(el("span", null, "Real city-pairs"), el("br"), el("small", null, `${realShare.toFixed(1)}% of network`));
      return cell;
    })(),
    el("strong", null, String(data.real_links))
  );

  const illusRow = el("div", "legend-row");
  const illusDot = el("span", "legend-dot illus");
  illusDot.setAttribute("aria-hidden", "true");
  illusRow.append(
    illusDot,
    (() => {
      const cell = el("span");
      cell.append(el("span", null, "Illustrative links"), el("br"), el("small", null, `${(100 - realShare).toFixed(1)}% of network`));
      return cell;
    })(),
    el("strong", null, String(data.illustrative_links))
  );

  legend.append(realRow, illusRow);
  donutWrap.append(donut, legend);
  composition.appendChild(donutWrap);

  // Hubs
  const hubs = $("#hubs-body");
  hubs.replaceChildren();
  const hubList = el("div", "hub-list");
  const maxConnections = Math.max(...data.hubs.map((hub) => hub.connections), 1);
  data.hubs.forEach((hub) => {
    const row = el("div", "hub-row");
    const main = el("div", "hub-main");
    const top = el("div", "hub-top");
    top.append(el("span", null, `${hub.city} · ${hub.code}`), el("span", "hub-count", String(hub.connections)));
    const track = el("div", "hub-track");
    const fill = el("span");
    fill.style.width = `${Math.round((hub.connections / maxConnections) * 100)}%`;
    track.appendChild(fill);
    main.append(top, track);
    row.append(codeChip(hub.code, "neutral"), main);
    hubList.appendChild(row);
  });
  hubs.appendChild(hubList);

  // Extremes
  const links = $("#links-body");
  links.replaceChildren();

  function linkCard(label, edge) {
    const card = el("div", "link-card");
    card.append(el("div", "link-label", label));
    const routeLine = el("div", "link-route");
    routeLine.append(
      codeChip(edge.from, "neutral"),
      icon("chevron-right", "icon"),
      codeChip(edge.to, "neutral")
    );
    const meta = el("div", "link-meta");
    meta.append(el("strong", null, `${formatKm(edge.km)} km`), tagEl(edge.type));
    card.append(routeLine, meta);
    return card;
  }

  links.append(
    linkCard("Longest demo link", data.longest),
    linkCard("Shortest demo link", data.shortest)
  );

  const hint = el("p", "fine-print");
  hint.textContent = "Computed from data/airports.json at request time. Not live airline data.";
  links.appendChild(hint);
}

/* --------------------------------- Boot ----------------------------------- */
function initPlanner() {
  setupCombobox("source");
  setupCombobox("destination");

  $("#find-btn").addEventListener("click", findRoute);
  $("#reset-btn").addEventListener("click", resetPlanner);
  $("#swap-btn").addEventListener("click", swapAirports);
  $("#back-best").addEventListener("click", () => {
    state.activeIndex = 0;
    renderResults();
    drawRoutes();
  });
  $("#map-jump").addEventListener("click", () => {
    const panel = $(".map-panel");
    if (!panel) return;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (map) map.invalidateSize();
    }, 320);
  });
}

async function loadNetwork() {
  try {
    const data = await api.airports();
    state.airports = data.airports || [];
    state.connections = data.connections || [];
    state.disclaimer = data.disclaimer || "";
    state.byCode = new Map(state.airports.map((airport) => [airport.code, airport]));

    const degree = new Map(state.airports.map((airport) => [airport.code, 0]));
    const pairs = new Set();
    state.connections.forEach((connection) => {
      const key = [connection.from, connection.to].sort().join("-");
      if (!pairs.has(key)) {
        pairs.add(key);
        degree.set(connection.from, (degree.get(connection.from) || 0) + 1);
        degree.set(connection.to, (degree.get(connection.to) || 0) + 1);
      }
    });
    state.degrees = degree;
    state.uniqueLinkCount = pairs.size;
    state.networkLoaded = true;

    $("#nav-airport-count").hidden = false;
    $("#nav-airport-count").textContent = String(state.airports.length);
    $("#net-meta").textContent = `${state.airports.length} airports · ${pairs.size} links`;

    renderAirportStats();
    renderAirportDirectory();
    drawNetwork();
    setApiStatus(true);
    refreshActions();
  } catch (error) {
    setApiStatus(false);
    const body = $("#airport-list");
    body.replaceChildren();
    const wrap = el("div", "empty-state");
    wrap.append(
      icon("alert", "icon"),
      el("h3", null, "Could not load the airport network"),
      el("p", null, "The Flask API did not respond. Start the server and retry.")
    );
    const retry = el("button", "btn btn-ghost btn-sm", "Retry");
    retry.type = "button";
    retry.addEventListener("click", loadNetwork);
    wrap.appendChild(retry);
    body.appendChild(wrap);
    $("#net-meta").textContent = "Dataset unavailable";
    toast("Could not load the airport network", "error");
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSidebar();
  initSkipLink();
  initRouter();
  initPlanner();
  initMap();
  initAirportsPage();
  loadNetwork();
  navigate();
});
