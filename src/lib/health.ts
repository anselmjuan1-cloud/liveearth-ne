import type { Camera, Health, HealthState, Tier } from "./types";
import type { ProbeResult } from "./probe";

// Health is a state machine with hysteresis, not a boolean. One flaky probe must
// never blank a tile, and one lucky probe must never promote a dead camera.
//
//   LIVE --2 fails--> DEGRADED --3 fails--> STALE --24h--> DEAD --30d--> RETIRED
//     ^                   |                    |             |
//     +---1 success-------+--------------------+-------------+
//
// A camera that reaches RETIRED is still never deleted: it is a place, and the
// operator may republish it later under a new source URL.

export const FAIL_TO_DEGRADED = 2;
export const FAIL_TO_STALE = 5;
export const STALE_TO_DEAD_H = 24;
export const DEAD_TO_RETIRED_D = 30;
/** Byte-identical stills this many sweeps running means a frozen camera. */
export const FROZEN_LIMIT = 6;

/** Sweep interval is 10 minutes, so these are expressed in sweeps. */
const TIER_INTERVAL_SWEEPS: Record<Tier, number> = {
  0: 1, // on screen now
  1: 3, // routing-eligible
  2: 18, // long tail
  3: 6 // in recovery (further multiplied by backoff)
};

export function newHealth(id: string): Health {
  return {
    id,
    state: "LIVE",
    tier: 2,
    okStreak: 0,
    failStreak: 0,
    frozenStreak: 0,
    activeSourceIndex: 0
  };
}

function backoffSweeps(failStreak: number): number {
  // 6, 12, 24, 48, capped at 144 sweeps (~24h).
  return Math.min(144, 6 * Math.pow(2, Math.max(0, failStreak - FAIL_TO_STALE)));
}

export function applyProbe(
  prev: Health,
  result: ProbeResult,
  now: Date,
  sweep: number
): Health {
  const h: Health = { ...prev, lastCheckAt: now.toISOString(), latencyMs: result.latencyMs };

  if (result.ok) {
    h.okStreak = prev.okStreak + 1;
    h.failStreak = 0;
    h.lastOkAt = now.toISOString();

    // Up but static. Counts as reachable, not as watchable.
    if (result.signature && result.signature === prev.lastSignature) {
      h.frozenStreak = prev.frozenStreak + 1;
    } else {
      h.frozenStreak = 0;
    }
    h.lastSignature = result.signature;
    h.state = h.frozenStreak >= FROZEN_LIMIT ? "DEGRADED" : "LIVE";
  } else {
    h.failStreak = prev.failStreak + 1;
    h.okStreak = 0;
    if (h.failStreak >= FAIL_TO_STALE) h.state = "STALE";
    else if (h.failStreak >= FAIL_TO_DEGRADED) h.state = "DEGRADED";
  }

  // Escalate on elapsed time, not just consecutive failures.
  if (h.state === "STALE" && h.lastOkAt) {
    const hours = (now.getTime() - Date.parse(h.lastOkAt)) / 3600000;
    if (hours > STALE_TO_DEAD_H) h.state = "DEAD";
  }
  if (h.state === "DEAD" && h.lastOkAt) {
    const days = (now.getTime() - Date.parse(h.lastOkAt)) / 86400000;
    if (days > DEAD_TO_RETIRED_D) h.state = "RETIRED";
  }

  h.tier = nextTier(h);
  const interval =
    h.state === "LIVE" || h.state === "DEGRADED"
      ? TIER_INTERVAL_SWEEPS[h.tier]
      : backoffSweeps(h.failStreak);
  h.nextCheckAt = String(sweep + interval);
  return h;
}

function nextTier(h: Health): Tier {
  if (h.state === "DEAD" || h.state === "RETIRED" || h.state === "STALE") return 3;
  if (h.tier === 0) return 0; // pinned by the shelf builder while on screen
  return h.state === "LIVE" ? 1 : 2;
}

/**
 * Source rotation. When the active source fails repeatedly but the camera has
 * alternatives, move to the next one before declaring the place dead. This is
 * what keeps a camera on the map across URL churn.
 */
export function rotateSource(camera: Camera, h: Health): Health {
  if (camera.sources.length < 2) return h;
  if (h.failStreak < FAIL_TO_DEGRADED) return h;
  return {
    ...h,
    activeSourceIndex: (h.activeSourceIndex + 1) % camera.sources.length,
    failStreak: 0
  };
}

export function isShowable(state: HealthState): boolean {
  return state === "LIVE";
}

/**
 * Probe budget allocation. We cannot sweep every camera every ten minutes
 * without hammering the DOTs, so order by (exposure x staleness) / cost and
 * take the top N. Full coverage of the long tail comes around every ~50 min.
 */
export function selectForSweep(
  cameras: Camera[],
  health: Record<string, Health>,
  sweep: number,
  budget: number
): Camera[] {
  const due = cameras.filter((c) => {
    const h = health[c.id];
    if (!h) return true;
    if (h.state === "RETIRED") return sweep % 144 === 0; // check once a day, just in case
    return Number(h.nextCheckAt ?? 0) <= sweep;
  });

  const priority = (c: Camera): number => {
    const h = health[c.id];
    if (!h) return 1000; // never seen; find out immediately
    const overdue = sweep - Number(h.nextCheckAt ?? sweep);
    const tierWeight = [100, 40, 8, 3][h.tier];
    return tierWeight + overdue;
  };

  return due.sort((a, b) => priority(b) - priority(a)).slice(0, budget);
}
