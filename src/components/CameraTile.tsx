"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { ScoredCamera } from "@/lib/types";

// Embed strategy. Only the hero gets a real decoding video element; everything
// else is a refreshing still. Nine simultaneous HLS players will stall a
// browser, and at thumbnail size a frame refreshed every 15s is
// indistinguishable from live -- so the wall costs almost nothing.

const STILL_REFRESH_MS = 15000;

interface Props {
  camera: ScoredCamera;
  /** Hero tiles decode live HLS; the rest poll stills. */
  live?: boolean;
  onDead?: (id: string) => void;
}

function stillUrl(camera: ScoredCamera): string | null {
  const s = camera.sources.find((x) => x.kind === "image");
  return s ? s.url : null;
}

function hlsUrl(camera: ScoredCamera): string | null {
  const s = camera.sources.find((x) => x.kind === "hls");
  return s ? s.url : null;
}

export default function CameraTile({ camera, live = false, onDead }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const still = stillUrl(camera);
  const hls = hlsUrl(camera);
  const useVideo = live && hls !== null;

  const reportDead = useCallback(() => {
    setFailed(true);
    onDead?.(camera.id);
    // Viewers are the densest health probe we have: they are watching exactly
    // the cameras that matter most, in real browsers, right now.
    void fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: camera.id, kind: useVideo ? "hls" : "image" })
    }).catch(() => {});
  }, [camera.id, onDead, useVideo]);

  // Poll stills on an interval with a cache-busting param.
  useEffect(() => {
    if (useVideo || !still) return;
    const t = setInterval(() => setTick((n) => n + 1), STILL_REFRESH_MS);
    return () => clearInterval(t);
  }, [useVideo, still]);

  useEffect(() => {
    if (!useVideo || !hls) return;
    let instance: Hls | null = null;
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    // Safari plays HLS natively; everywhere else needs hls.js.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hls;
      video.play().catch(() => {});
    } else {
      import("hls.js").then(({ default: HlsCtor }) => {
        if (cancelled || !HlsCtor.isSupported()) return;
        instance = new HlsCtor({ lowLatencyMode: false, maxBufferLength: 10 });
        instance.loadSource(hls);
        instance.attachMedia(video);
        instance.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal) reportDead();
        });
        video.play().catch(() => {});
      });
    }

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [useVideo, hls, reportDead]);

  const src = still ? `${still}${still.includes("?") ? "&" : "?"}t=${tick}` : null;

  return (
    <div className={`tile${failed ? " dead" : ""}`}>
      {useVideo ? (
        <video ref={videoRef} muted playsInline autoPlay />
      ) : src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={camera.name} loading="lazy" onError={reportDead} />
      ) : (
        <div className="fallback">no signal</div>
      )}

      <span className={`pill ${useVideo ? "live" : camera.isNight ? "night" : "still"}`}>
        {useVideo ? "LIVE" : camera.isNight ? "NIGHT" : "STILL"}
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
