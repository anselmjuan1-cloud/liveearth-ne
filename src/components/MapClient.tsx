"use client";

import { useEffect, useRef } from "react";
import type { ScoredCamera, WorldEvent } from "@/lib/types";

// Leaflet is loaded from the CDN at runtime rather than bundled: it is a large
// dependency used on one page, and it does not tolerate SSR.

const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";

declare global {
  interface Window {
    L?: any;
  }
}

function loadOnce(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.L) return Promise.resolve(window.L);

  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L));
      return;
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("leaflet failed to load"));
    document.head.appendChild(s);
  });
}

interface Props {
  cameras: ScoredCamera[];
  events: WorldEvent[];
}

export default function MapClient({ cameras, events }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const built = useRef(false);

  useEffect(() => {
    if (built.current || !ref.current) return;
    built.current = true;

    loadOnce().then((L) => {
      if (!L || !ref.current) return;
      const map = L.map(ref.current, { preferCanvas: true }).setView([42.6, -74.5], 6);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 18
      }).addTo(map);

      // Canvas circle markers, not DOM pins: four thousand DOM nodes will
      // freeze the page, and at this zoom a dot is all the detail there is.
      for (const c of cameras) {
        L.circleMarker([c.lat, c.lon], {
          radius: 3,
          weight: 0,
          fillColor: c.sources.some((s) => s.kind === "hls") ? "#5eead4" : "#64748b",
          fillOpacity: c.health === "LIVE" ? 0.85 : 0.25
        })
          .bindPopup(
            `<b>${c.name}</b><br>${c.state}${c.roadway ? ` · ${c.roadway}` : ""}<br>${
              c.sources.some((s) => s.kind === "hls") ? "live video" : "still image"
            }`
          )
          .addTo(map);
      }

      for (const e of events) {
        if (e.polygon && e.polygon.length > 2) {
          L.polygon(
            e.polygon.map(([lon, lat]) => [lat, lon]),
            { color: "#f87171", weight: 1, fillOpacity: 0.1 }
          )
            .bindPopup(`<b>${e.title}</b><br>${e.detail ?? ""}`)
            .addTo(map);
        } else {
          L.circleMarker([e.lat, e.lon], {
            radius: 7,
            color: "#fbbf24",
            weight: 2,
            fillOpacity: 0.3
          })
            .bindPopup(`<b>${e.title}</b><br>${e.detail ?? ""}`)
            .addTo(map);
        }
      }
    });
  }, [cameras, events]);

  return <div id="map" ref={ref} />;
}
