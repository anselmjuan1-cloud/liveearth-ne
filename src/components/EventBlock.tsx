"use client";

import { useMemo, useState } from "react";
import CameraTile from "./CameraTile";
import type { RoutedEvent } from "@/lib/types";

// One event with the cameras nearest to it. Over-provisioning is deliberate:
// the server hands us more cameras than we render, so when a tile dies we can
// swap in a replacement with no visible gap and no round trip.

const VISIBLE = 6;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function EventBlock({ event }: { event: RoutedEvent }) {
  const [dead, setDead] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () => event.cameras.filter((c) => !dead.has(c.id)).slice(0, VISIBLE),
    [event.cameras, dead]
  );

  const markDead = (id: string) =>
    setDead((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  if (shown.length === 0) return null;
  const [hero, ...rest] = shown;

  return (
    <section className="event">
      <div className="event-head">
        <span className={`badge ${event.kind}`}>{event.kind}</span>
        <span className="event-title">{event.title}</span>
        <span className="event-sub">
          {event.detail ? `${event.detail} · ` : ""}
          {timeAgo(event.at)}
        </span>
      </div>

      <div className="hero">
        <CameraTile camera={hero} priority onDead={markDead} />
        <div className="hero-side">
          {rest.slice(0, 2).map((c) => (
            <CameraTile key={c.id} camera={c} onDead={markDead} />
          ))}
        </div>
      </div>

      {rest.length > 2 && (
        <div className="grid">
          {rest.slice(2).map((c) => (
            <CameraTile key={c.id} camera={c} onDead={markDead} />
          ))}
        </div>
      )}
    </section>
  );
}
