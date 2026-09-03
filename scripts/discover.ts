import { DOT_PROVIDERS, ingestProvider } from "../src/lib/sources/dot511";
import type { Camera, Registry } from "../src/lib/types";
import { readState, writeOut, writeSeed } from "./io";

// Discovery. Runs every 6 hours.
//
// Merges freshly ingested cameras into the existing registry. Cameras are
// places and are never deleted -- if one vanishes from a DOT feed it keeps its
// entry and its original firstSeen, and the health sweep is what decides
// whether it can be shown. That is the whole reason a camera survives URL churn.

const WRITE_SEED = process.argv.includes("--seed");

/**
 * Choose a bundled subset: proportional by state, cameras with live HLS video
 * first, then spatially thinned so the sample is spread rather than clustered
 * in whichever metro happens to sort first.
 */
function pickSeed(cameras: Camera[], limit: number): Camera[] {
  const byState = new Map<string, Camera[]>();
  for (const c of cameras) {
    const list = byState.get(c.state) ?? [];
    list.push(c);
    byState.set(c.state, list);
  }

  const out: Camera[] = [];
  for (const [, list] of byState) {
    const quota = Math.max(20, Math.round((list.length / cameras.length) * limit));
    const ranked = [...list].sort((a, b) => {
      const av = a.sources.some((s) => s.kind === "hls") ? 1 : 0;
      const bv = b.sources.some((s) => s.kind === "hls") ? 1 : 0;
      return bv - av;
    });
    // Even stride keeps the sample geographically spread within the state.
    const stride = Math.max(1, Math.floor(ranked.length / quota));
    for (let i = 0; i < ranked.length && out.length < limit * 1.5; i += stride) {
      out.push(ranked[i]);
    }
  }
  return out.slice(0, limit);
}

async function main() {
  const previous = readState<Registry>("registry.json", "registry.seed.json");
  const known = new Map<string, Camera>((previous?.cameras ?? []).map((c) => [c.id, c]));

  let added = 0;
  let updated = 0;

  for (const provider of DOT_PROVIDERS) {
    if (!provider.enabled) {
      console.log(`skip ${provider.id}: ${provider.note ?? "disabled"}`);
      continue;
    }
    try {
      const cameras = await ingestProvider(provider);
      console.log(`${provider.id}: ${cameras.length} cameras in the NE bbox`);
      for (const cam of cameras) {
        const prior = known.get(cam.id);
        if (prior) {
          // Refresh mutable fields, preserve identity and history.
          known.set(cam.id, { ...cam, firstSeen: prior.firstSeen });
          updated++;
        } else {
          known.set(cam.id, cam);
          added++;
        }
      }
    } catch (e) {
      // One provider being down must never wipe the index.
      console.error(`${provider.id} FAILED: ${(e as Error).message}`);
    }
  }

  const cameras = [...known.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (cameras.length === 0) {
    console.error("refusing to write an empty registry");
    process.exit(1);
  }

  const registry: Registry = { generatedAt: new Date().toISOString(), cameras };
  writeOut("registry.json", registry);
  // The bundled seed is a capped, geographically spread subset so it does not
  // bloat the Vercel function bundle. The full registry lives on the data branch.
  if (WRITE_SEED) {
    const seed: Registry = { generatedAt: registry.generatedAt, cameras: pickSeed(cameras, 900) };
    writeSeed("registry.seed.json", seed);
    console.log(`seed: ${seed.cameras.length} cameras`);
  }

  const byState = cameras.reduce<Record<string, number>>((acc, c) => {
    acc[c.state] = (acc[c.state] ?? 0) + 1;
    return acc;
  }, {});
  const withHls = cameras.filter((c) => c.sources.some((s) => s.kind === "hls")).length;

  console.log(`\ntotal ${cameras.length} cameras (+${added} new, ${updated} refreshed)`);
  console.log(`with live HLS video: ${withHls}`);
  console.log(`by state: ${JSON.stringify(byState)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
