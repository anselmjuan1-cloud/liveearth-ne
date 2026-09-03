import type { RoutedEvent, ScoredCamera, WorldEvent } from "./types";
import type { LiveCamera } from "./data";
import { haversineKm, pointInPolygon } from "./geo";
import { isNight } from "./solar";

// The event router. This is the part nobody has built: a spatial index that
// joins live events to live cameras, so the system picks what you watch instead
// of making you browse a directory.

const MAX_KM = 120;

export function scoreCamera(
  camera: LiveCamera,
  event: WorldEvent,
  now: Date
): ScoredCamera | null {
  const distanceKm = haversineKm(camera.lat, camera.lon, event.lat, event.lon);

  // Inside an alert polygon counts as distance zero regardless of how far the
  // centroid happens to be -- a long county-shaped warning area would otherwise
  // rank its own cameras poorly.
  const inside = event.polygon ? pointInPolygon(camera.lat, camera.lon, event.polygon) : false;
  if (!inside && distanceKm > MAX_KM) return null;

  const night = isNight(now, camera.lat, camera.lon);
  const effective = inside ? 0 : distanceKm;

  let score = 100 - effective * 0.6;
  if (!camera.live) score -= 60; // unverified or failing: heavily demoted, not hidden
  if (night) score -= 25; // a dark frame is technically live and visually useless
  if (camera.sources.some((s) => s.kind === "hls")) score += 15; // motion beats stills
  if (camera.geoTier === "precise") score += 5;

  return { ...camera, health: camera.live ? "LIVE" : "DEGRADED", distanceKm, isNight: night, score };
}

export function routeEvent(
  event: WorldEvent,
  cameras: LiveCamera[],
  limit = 6,
  now = new Date()
): RoutedEvent {
  const scored: ScoredCamera[] = [];
  for (const cam of cameras) {
    const s = scoreCamera(cam, event, now);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);

  // Spread picks across providers so one dense metro does not fill every slot.
  const picked: ScoredCamera[] = [];
  const perProvider = new Map<string, number>();
  for (const cam of scored) {
    const n = perProvider.get(cam.provider) ?? 0;
    if (n >= Math.ceil(limit / 2) && picked.length < limit) continue;
    perProvider.set(cam.provider, n + 1);
    picked.push(cam);
    if (picked.length >= limit) break;
  }

  return { ...event, cameras: picked };
}

export function routeAll(
  events: WorldEvent[],
  cameras: LiveCamera[],
  perEvent = 6,
  now = new Date()
): RoutedEvent[] {
  return events
    .map((e) => routeEvent(e, cameras, perEvent, now))
    .filter((e) => e.cameras.length > 0);
}

/**
 * Ambient fallback: when nothing is happening, still show something good.
 * Prefers daylit cameras with real video, spread across the region so the wall
 * is not nine views of the same interchange.
 */
export function ambientPicks(cameras: LiveCamera[], count = 9, now = new Date()): ScoredCamera[] {
  const pool = cameras
    .filter((c) => c.live && !isNight(now, c.lat, c.lon))
    .map((c): ScoredCamera => {
      let score = Math.random() * 20;
      if (c.sources.some((s) => s.kind === "hls")) score += 30;
      return {
        ...c,
        health: "LIVE",
        distanceKm: 0,
        isNight: false,
        score
      };
    })
    .sort((a, b) => b.score - a.score);

  // If the whole region is dark, fall back to any live camera rather than
  // rendering an empty wall.
  const source = pool.length >= count ? pool : cameras.filter((c) => c.live).map((c): ScoredCamera => ({
    ...c,
    health: "LIVE",
    distanceKm: 0,
    isNight: isNight(now, c.lat, c.lon),
    score: 0
  }));

  const out: ScoredCamera[] = [];
  const seenState = new Map<string, number>();
  for (const cam of source) {
    const n = seenState.get(cam.state) ?? 0;
    if (n >= Math.ceil(count / 2)) continue;
    seenState.set(cam.state, n + 1);
    out.push(cam);
    if (out.length >= count) break;
  }
  return out;
}
