import { applyProbe, newHealth, rotateSource, selectForSweep } from "../src/lib/health";
import { probeSource } from "../src/lib/probe";
import type { Health, HealthFile, HealthState, Registry } from "../src/lib/types";
import { pMap, readState, writeOut } from "./io";

// Health sweep. Runs every 10 minutes.
//
// Does not probe everything: it takes the highest-priority slice within a fixed
// budget, so hot cameras are checked every sweep and the long tail comes around
// roughly hourly. This keeps us a polite client of the DOT hosts while still
// guaranteeing nothing dead reaches a hero slot.

const BUDGET = Number(process.env.SWEEP_BUDGET ?? 700);
const CONCURRENCY = Number(process.env.SWEEP_CONCURRENCY ?? 24);

async function main() {
  const registry = readState<Registry>("registry.json", "registry.seed.json");
  if (!registry || registry.cameras.length === 0) {
    console.error("no registry; run discover first");
    process.exit(1);
  }

  const prior = readState<HealthFile>("health.json");
  const sweep = (prior?.sweep ?? 0) + 1;
  const now = new Date();

  // Health is keyed by camera id and would otherwise accumulate entries for
  // cameras that have left the registry, inflating the reported state counts.
  // The registry is the authority on what exists.
  const ids = new Set(registry.cameras.map((c) => c.id));
  const health: Record<string, Health> = {};
  let orphaned = 0;
  for (const [id, h] of Object.entries(prior?.health ?? {})) {
    if (ids.has(id)) health[id] = h;
    else orphaned++;
  }
  if (orphaned > 0) console.log(`dropped ${orphaned} health entries not in the registry`);

  const batch = selectForSweep(registry.cameras, health, sweep, BUDGET);
  console.log(`sweep #${sweep}: probing ${batch.length} of ${registry.cameras.length}`);

  let ok = 0;
  await pMap(batch, CONCURRENCY, async (camera) => {
    const before = health[camera.id] ?? newHealth(camera.id);
    const source = camera.sources[before.activeSourceIndex] ?? camera.sources[0];
    if (!source) return;

    const result = await probeSource(source);
    let next = applyProbe(before, result, now, sweep);
    // Try the camera's other source before blaming the place itself.
    if (!result.ok) next = rotateSource(camera, next);
    health[camera.id] = next;
    if (result.ok) ok++;
  });

  const counts: Record<HealthState, number> = {
    LIVE: 0,
    DEGRADED: 0,
    STALE: 0,
    DEAD: 0,
    RETIRED: 0
  };
  for (const h of Object.values(health)) counts[h.state]++;

  const file: HealthFile = {
    generatedAt: now.toISOString(),
    sweep,
    counts,
    probed: batch.length,
    health
  };
  writeOut("health.json", file);

  const rate = batch.length > 0 ? Math.round((ok / batch.length) * 100) : 0;
  console.log(`probe success ${ok}/${batch.length} (${rate}%)`);
  console.log(`states: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
