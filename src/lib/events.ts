import type { WorldEvent } from "./types";
import { NE_BBOX, NE_STATES, inNortheast } from "./geo";

// Event layer. Both sources are keyless and public.
//   USGS  -- earthquake feed, global, updates within minutes.
//   NWS   -- active weather alerts with real affected polygons.
//
// The events are what turn a camera grid into something worth looking at: they
// answer "why am I being shown this particular camera right now".

const UA = "liveearth-ne/0.1 (github.com) contact-via-repo";

interface UsgsFeature {
  id: string;
  properties: { mag?: number; place?: string; time?: number; url?: string; title?: string };
  geometry: { coordinates: [number, number, number] };
}

/**
 * The bulk all_week.geojson feed is ~2MB, which exceeds the Next data cache
 * limit and so refetches on every revalidation. The FDSN query API filters by
 * bounding box server-side and returns a few KB instead. starttime is rounded
 * to the day so the URL stays a stable cache key.
 */
function quakeQueryUrl(): string {
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    format: "geojson",
    starttime: start,
    minlatitude: String(NE_BBOX.minLat),
    maxlatitude: String(NE_BBOX.maxLat),
    minlongitude: String(NE_BBOX.minLon),
    maxlongitude: String(NE_BBOX.maxLon),
    minmagnitude: "1",
    orderby: "time"
  });
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${p}`;
}

async function fetchQuakes(): Promise<WorldEvent[]> {
  try {
    const res = await fetch(quakeQueryUrl(), {
      headers: { "User-Agent": UA },
      next: { revalidate: 300 }
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { features: UsgsFeature[] };
    return json.features
      .map((f): WorldEvent | null => {
        const [lon, lat] = f.geometry.coordinates;
        if (!inNortheast(lat, lon)) return null;
        const mag = f.properties.mag ?? 0;
        return {
          id: `quake:${f.id}`,
          kind: "quake",
          title: f.properties.title ?? `M${mag} earthquake`,
          // M1 is background noise, M6 is a major regional event.
          severity: Math.max(0, Math.min(1, (mag - 1) / 5)),
          lat,
          lon,
          at: new Date(f.properties.time ?? Date.now()).toISOString(),
          url: f.properties.url,
          detail: f.properties.place
        };
      })
      .filter((e): e is WorldEvent => e !== null);
  } catch {
    return [];
  }
}

interface NwsFeature {
  id: string;
  properties: {
    event?: string;
    headline?: string;
    severity?: string;
    areaDesc?: string;
    effective?: string;
    ends?: string;
  };
  geometry: { type: string; coordinates: number[][][] } | null;
}

const NWS_SEVERITY: Record<string, number> = {
  Extreme: 1,
  Severe: 0.8,
  Moderate: 0.5,
  Minor: 0.25,
  Unknown: 0.15
};

function centroid(ring: [number, number][]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

async function fetchAlerts(): Promise<WorldEvent[]> {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?area=${NE_STATES.join(",")}`,
      { headers: { "User-Agent": UA, Accept: "application/geo+json" }, next: { revalidate: 120 } }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { features: NwsFeature[] };
    const out: WorldEvent[] = [];
    for (const f of json.features) {
      // Alerts without geometry are county-coded only; skip them rather than
      // route cameras to a guessed centroid.
      if (!f.geometry || f.geometry.type !== "Polygon") continue;
      const ring = f.geometry.coordinates[0] as [number, number][];
      if (!ring || ring.length < 3) continue;
      const c = centroid(ring);
      if (!inNortheast(c.lat, c.lon)) continue;
      out.push({
        id: `alert:${f.id}`,
        kind: "alert",
        title: f.properties.event ?? "Weather alert",
        severity: NWS_SEVERITY[f.properties.severity ?? "Unknown"] ?? 0.2,
        lat: c.lat,
        lon: c.lon,
        polygon: ring,
        at: f.properties.effective ?? new Date().toISOString(),
        detail: f.properties.areaDesc
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getEvents(): Promise<WorldEvent[]> {
  const [quakes, alerts] = await Promise.all([fetchQuakes(), fetchAlerts()]);
  return [...quakes, ...alerts].sort(
    (a, b) => b.severity - a.severity || Date.parse(b.at) - Date.parse(a.at)
  );
}

export { NE_BBOX };
