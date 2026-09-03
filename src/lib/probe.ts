import type { CameraSource } from "./types";

export interface ProbeResult {
  ok: boolean;
  /** Cheap content fingerprint. Identical across probes means the camera is up
   *  but showing nothing new -- the failure mode a status code cannot see. */
  signature?: string;
  latencyMs: number;
  reason?: string;
}

const UA = "liveearth-ne/0.1 health-probe";
const TIMEOUT_MS = 9000;

async function timed(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { "User-Agent": UA, ...(init.headers ?? {}) },
      cache: "no-store"
    });
  } finally {
    clearTimeout(t);
  }
}

// A 200 from an HLS endpoint proves very little: frozen streams return 200
// forever. What matters is that the manifest parses and points at real segments,
// and that the media sequence number advances between sweeps.
async function probeHls(url: string): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await timed(url);
    if (!res.ok) return { ok: false, latencyMs: Date.now() - t0, reason: `HTTP ${res.status}` };
    const body = await res.text();
    if (!body.includes("#EXTM3U")) {
      return { ok: false, latencyMs: Date.now() - t0, reason: "not a manifest" };
    }

    // Master playlist: follow one level down to the chunklist, where the media
    // sequence number lives.
    if (body.includes("#EXT-X-STREAM-INF")) {
      const variant = body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith("#"));
      if (!variant) return { ok: false, latencyMs: Date.now() - t0, reason: "no variant" };

      const chunkUrl = new URL(variant, url).toString();
      const cres = await timed(chunkUrl);
      if (!cres.ok) {
        return { ok: false, latencyMs: Date.now() - t0, reason: `chunklist ${cres.status}` };
      }
      const cbody = await cres.text();
      const segs = (cbody.match(/#EXTINF/g) ?? []).length;
      if (segs === 0) return { ok: false, latencyMs: Date.now() - t0, reason: "empty chunklist" };
      const seq = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(cbody)?.[1];
      return { ok: true, signature: `seq:${seq ?? "?"}`, latencyMs: Date.now() - t0 };
    }

    const seq = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(body)?.[1];
    return { ok: true, signature: `seq:${seq ?? "?"}`, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, reason: (e as Error).name };
  }
}

async function probeImage(url: string): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await timed(url);
    if (!res.ok) return { ok: false, latencyMs: Date.now() - t0, reason: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return { ok: false, latencyMs: Date.now() - t0, reason: `type ${type}` };
    }
    const buf = await res.arrayBuffer();
    // Offline placeholder cards are small and uniform; real frames are not.
    if (buf.byteLength < 3000) {
      return { ok: false, latencyMs: Date.now() - t0, reason: "tiny image" };
    }
    const etag = res.headers.get("etag");
    return {
      ok: true,
      signature: etag ?? `len:${buf.byteLength}`,
      latencyMs: Date.now() - t0
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, reason: (e as Error).name };
  }
}

export async function probeSource(source: CameraSource): Promise<ProbeResult> {
  if (source.kind === "hls") return probeHls(source.url);
  if (source.kind === "image") return probeImage(source.url);
  // YouTube liveness cannot be determined reliably without the Data API. The
  // watch page carries identical markers for live and ended streams, and the
  // hqdefault_live.jpg endpoint 404s on genuinely live videos. Needs videos.list.
  return { ok: false, latencyMs: 0, reason: "youtube probe requires API key" };
}
