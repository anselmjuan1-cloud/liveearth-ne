import MapClient from "@/components/MapClient";
import { getShelf } from "@/lib/data";
import { getEvents } from "@/lib/events";
import type { ScoredCamera } from "@/lib/types";
import { isNight } from "@/lib/solar";

export const revalidate = 120;

export default async function MapPage() {
  const [shelf, events] = await Promise.all([getShelf(), getEvents()]);
  const now = new Date();

  // Trim to what the map actually draws. Shipping full source arrays for four
  // thousand cameras to the client would be a multi-megabyte payload.
  const cameras: ScoredCamera[] = shelf.map((c) => ({
    ...c,
    sources: c.sources.map((s) => ({ kind: s.kind, url: "" })),
    health: c.live ? "LIVE" : "DEGRADED",
    distanceKm: 0,
    isNight: isNight(now, c.lat, c.lon),
    score: 0
  }));

  return (
    <>
      <div className="stats">
        <span>
          <b>{cameras.length.toLocaleString()}</b> cameras
        </span>
        <span>
          <b>{events.length}</b> events
        </span>
        <span style={{ color: "#5eead4" }}>teal = live video</span>
        <span style={{ color: "#64748b" }}>grey = still image</span>
      </div>
      <div style={{ height: 22 }} />
      <MapClient cameras={cameras} events={events} />
    </>
  );
}
