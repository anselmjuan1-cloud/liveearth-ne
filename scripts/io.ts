import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Workers read the previous state from a checkout of the `data` branch (_data)
// and write the next state to _out, which publish-data.sh commits back.
// Falling back to the bundled seed means the first-ever run still works.

export const ROOT = resolve(import.meta.dirname, "..");
export const DATA_IN = join(ROOT, "_data");
export const OUT = join(ROOT, "_out");
export const SEED = join(ROOT, "data");

export function readState<T>(file: string, seedFile?: string): T | null {
  const candidates = [join(DATA_IN, file)];
  if (seedFile) candidates.push(join(SEED, seedFile));
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
      } catch (e) {
        console.warn(`could not parse ${path}: ${(e as Error).message}`);
      }
    }
  }
  return null;
}

export function writeOut(file: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), JSON.stringify(data), "utf8");
}

export function writeSeed(file: string, data: unknown): void {
  mkdirSync(SEED, { recursive: true });
  writeFileSync(join(SEED, file), JSON.stringify(data), "utf8");
}

/** Bounded-concurrency map. Keeps us from hammering the DOT hosts. */
export async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
