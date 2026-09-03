"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { ScoredCamera } from "@/lib/types";

// Live video only. Every tile is a real decoding player, which brings back the
// embed ceiling the poster wall used to dodge -- a dozen simultaneous HLS
// streams will stall a browser. Two defences:
//
//   1. Virtualization. A player is created only while the tile is actually on
//      screen, and torn down when it scrolls away.
//   2. A global budget. Even on screen, no more than MAX_PLAYERS decode at once;
//      tiles beyond the budget wait and show a placeholder until a slot frees.

const MAX_PLAYERS = 8;

let activePlayers = 0;
const waiting = new Set<() => void>();

function acquireSlot(): boolean {
  if (activePlayers >= MAX_PLAYERS) return false;
  activePlayers++;
  return true;
}

function releaseSlot() {
  activePlayers = Math.max(0, activePlayers - 1);
  const next = waiting.values().next();
  if (!next.done) {
    waiting.delete(next.value);
    next.value();
  }
}

interface Props {
  camera: ScoredCamera;
  /** Hero tiles get priority for a decode slot. */
  priority?: boolean;
  onDead?: (id: string) => void;
}

export default function CameraTile({ camera, priority = false, onDead }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(priority);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const url = camera.sources.find((s) => s.kind === "hls")?.url ?? null;

  const reportDead = useCallback(() => {
    setFailed(true);
    onDead?.(camera.id);
    // A browser that just failed to decode is the most reliable health signal
    // available, and it comes from a camera someone is actually watching.
    void fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: camera.id, kind: "hls" })
    }).catch(() => {});
  }, [camera.id, onDead]);

  // Only decode what is on screen.
  useEffect(() => {
    if (priority) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [priority]);

  useEffect(() => {
    if (!visible || !url || failed) return;

    let instance: Hls | null = null;
    let cancelled = false;
    let holdsSlot = false;

    const start = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;
      holdsSlot = true;
      setPlaying(true);

      // Safari plays HLS natively; everywhere else needs hls.js.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }
      import("hls.js").then(({ default: HlsCtor }) => {
        if (cancelled || !HlsCtor.isSupported()) return;
        instance = new HlsCtor({
          lowLatencyMode: false,
          maxBufferLength: 6,
          capLevelToPlayerSize: true
        });
        instance.loadSource(url);
        instance.attachMedia(video);
        instance.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal) reportDead();
        });
        video.play().catch(() => {});
      });
    };

    if (acquireSlot()) {
      start();
    } else {
      // No decode slot free; queue for the next one.
      waiting.add(start);
    }

    return () => {
      cancelled = true;
      waiting.delete(start);
      instance?.destroy();
      if (holdsSlot) releaseSlot();
      setPlaying(false);
    };
  }, [visible, url, failed, reportDead]);

  return (
    <div className={`tile${failed ? " dead" : ""}`} ref={wrapRef}>
      {failed || !url ? (
        <div className="fallback">no signal</div>
      ) : (
        <>
          <video ref={videoRef} muted playsInline autoPlay preload="none" />
          {!playing && <div className="fallback loading">connecting…</div>}
        </>
      )}

      <span className={`pill ${camera.isNight ? "night" : "live"}`}>
        {camera.isNight ? "NIGHT" : "LIVE"}
      </span>

      <div className="meta">
        <div className="name">{camera.name}</div>
        <div className="sub">
          {camera.state}
          {camera.roadway ? ` · ${camera.roadway}` : ""}
          {camera.distanceKm > 0 ? ` · ${camera.distanceKm.toFixed(1)} km` : ""}
        </div>
      </div>
    </div>
  );
}
