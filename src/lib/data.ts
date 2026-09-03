import type { Camera, HealthFile, Registry } from "./types";
import seedRegistry from "../../data/registry.seed.json";

// Storage strategy for a GitHub + Vercel Hobby build.
//
// There is no database. GitHub Actions writes registry.json and health.json to
// an orphan `data` branch; the app reads them from raw.githubusercontent.com and
// caches at the Vercel edge. vercel.json disables deployments for that branch,
// so worker commits never burn the 100-deploys/day Hobby limit.
//
// The bundled seed keeps the app fully functional on the very first deploy,
// before any Action has run.

const OWNER = process.env.NEXT_PUBLIC_GH_OWNER ?? "";
const REPO = process.env.NEXT_PUBLIC_GH_REPO ?? "";
const BRANCH = process.env.NEXT_PUBLIC_GH_DATA_BRANCH ?? "data";

const REMOTE_ENABLED = OWNER.length > 0 && REPO.length > 0;
const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

// raw.githubusercontent caches ~5 min, and the sweep runs every 10, so a 120s
// revalidate costs nothing and keeps the edge warm.
const REVALIDATE = 120;

async function fetchJson<T>(path: string): Promise<T | null> {
  if (!REMOTE_ENABLED) return null;
  try {
    const res = await fetch(`${base}/${path}`, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getRegistry(): Promise<Registry> {
  const remote = await fetchJson<Registry>("registry.json");
  if (remote && Array.isArray(remote.cameras) && remote.cameras.length > 0) return remote;
  return seedRegistry as Registry;
}

export async function getHealth(): Promise<HealthFile | null> {
  return fetchJson<HealthFile>("health.json");
}

export interface LiveCamera extends Camera {
  live: boolean;
  lastOkAt?: string;
}

/**
 * The read path never sees raw source rows. It sees a shelf: cameras joined to
 * their current health, with anything not LIVE marked so the UI can refuse to
 * feature it. A dead camera is structurally unable to reach a hero slot.
 */
export async function getShelf(): Promise<LiveCamera[]> {
  const [registry, health] = await Promise.all([getRegistry(), getHealth()]);
  return registry.cameras.map((c) => {
    const h = health?.health?.[c.id];
    return {
      ...c,
      // Before the first sweep there is no health data at all. Treat unknown as
      // showable-but-unverified rather than hiding the entire index.
      live: h ? h.state === "LIVE" : true,
      lastOkAt: h?.lastOkAt
    };
  });
}
