import EventBlock from "@/components/EventBlock";
import Wall from "@/components/Wall";
import { getHealth, getShelf } from "@/lib/data";
import { getEvents } from "@/lib/events";
import { ambientPicks, routeAll } from "@/lib/router";

// The front door is the event router, not a directory. The system picks what
// you look at, and says why. When the region is quiet it falls through to
// ambient rather than showing an empty page.

export const revalidate = 120;

export default async function EventsPage() {
  const [shelf, health, events] = await Promise.all([getShelf(), getHealth(), getEvents()]);

  // Ask for more cameras per event than we render, so the client can fail over
  // to a standby without a round trip.
  const routed = routeAll(events, shelf, 10);
  const liveCount = shelf.filter((c) => c.live).length;
  const videoCount = shelf.filter((c) => c.sources.some((s) => s.kind === "hls")).length;

  return (
    <>
      <div className="stats">
        <span>
          <b>{shelf.length.toLocaleString()}</b> cameras indexed
        </span>
        <span>
          <b>{liveCount.toLocaleString()}</b> passing health checks
        </span>
        <span>
          <b>{videoCount.toLocaleString()}</b> with live video
        </span>
        <span>
          <b>{routed.length}</b> active events
        </span>
        <span>
          {health
            ? `sweep #${health.sweep} · ${new Date(health.generatedAt).toUTCString().slice(17, 22)} UTC`
            : "awaiting first health sweep"}
        </span>
      </div>

      <div style={{ height: 22 }} />

      {routed.length > 0 ? (
        routed.slice(0, 8).map((e) => <EventBlock key={e.id} event={e} />)
      ) : (
        <>
          <div className="empty" style={{ marginBottom: 22 }}>
            Nothing is happening in the Northeast right now — no active weather alerts
            or recent earthquakes in range of a camera. Falling through to ambient.
          </div>
          <Wall cameras={ambientPicks(shelf, 12)} />
        </>
      )}
    </>
  );
}
