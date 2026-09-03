import type { Camera, CameraSource } from "../types";
import { inNortheast, parseWkt } from "../geo";

// Most US state 511 sites run the same Castle Rock platform, which exposes a
// DataTables endpoint at /List/GetData/Cameras. It takes a form POST and needs
// no API key. Verified working for NY, PA, CT and New England (ME/NH/VT).
// NJ and MA run a different platform -- see the disabled entries below.

export interface DotProvider {
  id: string;
  host: string;
  /** States this feed covers. Multi-state feeds resolve per-record. */
  states: string[];
  enabled: boolean;
  note?: string;
}

export const DOT_PROVIDERS: DotProvider[] = [
  { id: "511ny", host: "www.511ny.org", states: ["NY"], enabled: true },
  { id: "511pa", host: "www.511pa.com", states: ["PA"], enabled: true },
  { id: "newengland511", host: "newengland511.org", states: ["ME", "NH", "VT"], enabled: true },
  { id: "ctroads", host: "ctroads.org", states: ["CT"], enabled: true },
  {
    id: "511nj",
    host: "511nj.org",
    states: ["NJ"],
    enabled: false,
    note: "Different platform; /List/GetData/Cameras returns nothing. Needs endpoint discovery."
  },
  {
    id: "mass511",
    host: "mass511.com",
    states: ["MA"],
    enabled: false,
    note: "Angular SPA on a different backend. Needs endpoint discovery."
  }
];

const UA = "liveearth-ne/0.1 camera-index";
// The platform caps page size server-side and 500s on large requests, so ask
// for 100 and advance by rows actually returned rather than by requested size.
const PAGE = 100;
const RETRIES = 3;

interface RawImage {
  imageUrl?: string;
  videoUrl?: string;
  videoType?: string;
  disabled?: boolean;
  blocked?: boolean;
  videoDisabled?: boolean;
  isVideoAuthRequired?: boolean;
}

interface RawCamera {
  id: number | string;
  images?: RawImage[];
  location?: string;
  roadway?: string;
  direction?: string;
  type?: string;
  /** Sometimes a 2-letter state code, sometimes a county FIPS code. */
  areaId?: string;
  /** Full state name, e.g. "Vermont". Present on multi-state feeds. */
  state?: string;
  latLng?: { geography?: { wellKnownText?: string } };
  visible?: boolean;
}

const STATE_NAMES: Record<string, string> = {
  "new york": "NY",
  pennsylvania: "PA",
  "new jersey": "NJ",
  connecticut: "CT",
  "rhode island": "RI",
  massachusetts: "MA",
  vermont: "VT",
  "new hampshire": "NH",
  maine: "ME"
};

/**
 * Multi-state feeds carry the state per record; single-state feeds do not.
 * areaId is a 2-letter code on some feeds and a county FIPS code on others,
 * so it is only trusted when it actually looks like a state code.
 */
function resolveState(provider: DotProvider, raw: RawCamera): string {
  if (provider.states.length === 1) return provider.states[0];
  if (raw.state) {
    const hit = STATE_NAMES[raw.state.trim().toLowerCase()];
    if (hit && provider.states.includes(hit)) return hit;
  }
  if (raw.areaId && /^[A-Za-z]{2}$/.test(raw.areaId)) {
    const code = raw.areaId.toUpperCase();
    if (provider.states.includes(code)) return code;
  }
  return provider.states[0];
}

async function fetchPage(host: string, start: number): Promise<{ rows: RawCamera[]; total: number }> {
  let lastError = "";
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetch(`https://${host}/List/GetData/Cameras`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": UA,
          Accept: "application/json"
        },
        body: new URLSearchParams({ start: String(start), length: String(PAGE), draw: "1" }),
        redirect: "follow"
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { data?: RawCamera[]; recordsTotal?: number };
      return { rows: json.data ?? [], total: json.recordsTotal ?? 0 };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(`${host} at offset ${start}: ${lastError}`);
}

function toCamera(provider: DotProvider, raw: RawCamera, now: string): Camera | null {
  const wkt = raw.latLng?.geography?.wellKnownText;
  if (!wkt) return null;
  const pos = parseWkt(wkt);
  if (!pos || !inNortheast(pos.lat, pos.lon)) return null;

  const sources: CameraSource[] = [];
  for (const img of raw.images ?? []) {
    if (img.disabled || img.blocked) continue;
    // HLS first: it is real live video, and these hosts send
    // Access-Control-Allow-Origin: * so the browser plays it with no proxy hop.
    if (img.videoUrl && !img.videoDisabled && !img.isVideoAuthRequired) {
      sources.push({ kind: "hls", url: img.videoUrl, rank: 0 });
    }
    if (img.imageUrl) {
      const url = img.imageUrl.startsWith("http")
        ? img.imageUrl
        : `https://${provider.host}${img.imageUrl}`;
      sources.push({ kind: "image", url, rank: 1 });
    }
  }
  if (sources.length === 0) return null;

  return {
    id: `${provider.id}:${raw.id}`,
    name: raw.location?.trim() || raw.roadway?.trim() || `Camera ${raw.id}`,
    lat: pos.lat,
    lon: pos.lon,
    state: resolveState(provider, raw),
    provider: provider.id,
    roadway: raw.roadway?.trim() || undefined,
    direction: raw.direction && raw.direction !== "Unknown" ? raw.direction : undefined,
    sources: sources.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)),
    // These feeds publish surveyed coordinates from the operating agency, so
    // they arrive at the top precision tier with no LLM extraction needed.
    geoTier: "precise",
    geoConfidenceM: 50,
    firstSeen: now
  };
}

export async function ingestProvider(provider: DotProvider): Promise<Camera[]> {
  const now = new Date().toISOString();
  const out: Camera[] = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const { rows, total: t } = await fetchPage(provider.host, start);
    total = t;
    // The server caps page size below what we ask for, so advance by what it
    // actually returned. Advancing by PAGE silently truncates the ingest.
    if (rows.length === 0) break;
    for (const raw of rows) {
      const cam = toCamera(provider, raw, now);
      if (cam) out.push(cam);
    }
    start += rows.length;
    if (start < total) await new Promise((r) => setTimeout(r, 350)); // be a polite client
  }
  return out;
}
