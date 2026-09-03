// Core model. The central decision: a Camera is a PLACE and is immortal.
// A Source is an ephemeral way to view that place and is expected to die.
// Link rot therefore becomes source-rotation, never camera deletion.

export type SourceKind = "hls" | "image" | "youtube";

export interface CameraSource {
  kind: SourceKind;
  url: string;
  /** Preferred ordering within a camera; lower wins. */
  rank?: number;
}

/** Precision tier gates which features a camera is allowed to power. */
export type GeoTier = "country" | "city" | "point" | "precise";

export interface Camera {
  /** Stable across source churn, e.g. "511ny:16". */
  id: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
  provider: string;
  roadway?: string;
  direction?: string;
  sources: CameraSource[];
  geoTier: GeoTier;
  geoConfidenceM: number;
  firstSeen: string;
}

export type HealthState = "LIVE" | "DEGRADED" | "STALE" | "DEAD" | "RETIRED";

/** 0 = on-screen now, 1 = routing-eligible, 2 = long tail, 3 = in recovery. */
export type Tier = 0 | 1 | 2 | 3;

export interface Health {
  id: string;
  state: HealthState;
  tier: Tier;
  okStreak: number;
  failStreak: number;
  /** Consecutive probes where the still image was byte-identical: camera up, showing nothing new. */
  frozenStreak: number;
  lastCheckAt?: string;
  lastOkAt?: string;
  nextCheckAt?: string;
  lastSignature?: string;
  latencyMs?: number;
  activeSourceIndex: number;
}

export interface Registry {
  generatedAt: string;
  cameras: Camera[];
}

export interface HealthFile {
  generatedAt: string;
  sweep: number;
  counts: Record<HealthState, number>;
  probed: number;
  health: Record<string, Health>;
}

export type EventKind = "quake" | "alert" | "fire";

export interface WorldEvent {
  id: string;
  kind: EventKind;
  title: string;
  severity: number; // 0..1, normalized for ranking
  lat: number;
  lon: number;
  /** Optional affected area; NWS alerts carry polygons. */
  polygon?: [number, number][]; // [lon, lat]
  at: string;
  url?: string;
  detail?: string;
}

export interface RoutedEvent extends WorldEvent {
  cameras: ScoredCamera[];
}

export interface ScoredCamera extends Camera {
  health: HealthState;
  distanceKm: number;
  isNight: boolean;
  score: number;
}
