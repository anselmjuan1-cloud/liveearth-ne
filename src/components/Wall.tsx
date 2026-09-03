"use client";

import { useEffect, useMemo, useState } from "react";
import CameraTile from "./CameraTile";
import type { ScoredCamera } from "@/lib/types";

// Ambient mode. A live hero that rotates on a timer, with more live feeds
// around it. Dead tiles are replaced from a standby pool rather than left blank.

const ROTATE_MS = 45000;
const WALL = 8;

export default function Wall({ cameras }: { cameras: ScoredCamera[] }) {
  const [heroIndex, setHeroIndex] = useState(0);
  const [dead, setDead] = useState<Set<string>>(new Set());

  const alive = useMemo(() => cameras.filter((c) => !dead.has(c.id)), [cameras, dead]);

  const heroPool = useMemo(
    () => alive.filter((c) => c.sources.some((s) => s.kind === "hls")),
    [alive]
  );

  useEffect(() => {
    if (heroPool.length < 2) return;
    const t = setInterval(() => setHeroIndex((i) => (i + 1) % heroPool.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [heroPool.length]);

  const markDead = (id: string) =>
    setDead((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const hero = heroPool[heroIndex % Math.max(1, heroPool.length)];
  const wall = alive.filter((c) => c.id !== hero?.id).slice(0, WALL);

  if (alive.length === 0) {
    return <div className="empty">No cameras are currently reachable.</div>;
  }

  return (
    <section className="event">
      <div className="event-head">
        <span className="badge quake">ambient</span>
        <span className="event-title">Northeast, right now</span>
        <span className="event-sub">
          {heroPool.length} live video · rotating every {ROTATE_MS / 1000}s
        </span>
      </div>

      {hero && (
        <div className="hero">
          <CameraTile key={hero.id} camera={hero} priority onDead={markDead} />
          <div className="hero-side">
            {wall.slice(0, 2).map((c) => (
              <CameraTile key={c.id} camera={c} onDead={markDead} />
            ))}
          </div>
        </div>
      )}

      <div className="grid">
        {wall.slice(2).map((c) => (
          <CameraTile key={c.id} camera={c} onDead={markDead} />
        ))}
      </div>
    </section>
  );
}
