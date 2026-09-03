# Architecture

A live-camera aggregator for the Northeast US that routes viewers to cameras
based on what is actually happening there. Runs entirely on GitHub + Vercel
Hobby, with no database and no API keys.

## The premise

A grid of webcams is a screensaver. The product is the **join**: the camera
shows what a place looks like, the event layer explains why you are looking at
it. The front door is an event router — something happens, the system finds the
nearest live camera and puts it on screen — not a directory you browse.

## The central modeling decision

Every webcam directory rots because it stores a URL and calls that a camera.
When the URL dies, the camera dies.

```
Camera   — a PLACE. lat/lon, name, state, geo tier. Immortal, never deleted.
Source   — an ephemeral way to view that place (hls | image | youtube).
           Many per camera. Expected to die.
Health   — a state machine over one camera's current source.
```

Link rot becomes **source rotation**, not deletion. When the active source fails
repeatedly, `rotateSource()` moves to the camera's next source before anything
is declared dead. A camera that fails every source still keeps its entry — the
operator may republish it later.

## Runtime shape

```
                  GitHub Actions (unlimited minutes on a public repo)
                  ┌──────────────────────────────────────────────┐
   DOT 511 feeds ─┤ discover.ts   every 6h   → registry.json      │
                  │ sweep.ts      every 10m  → health.json        │
                  └───────────────────┬──────────────────────────┘
                                      │ commits to orphan `data` branch
                                      ▼
                        raw.githubusercontent.com
                                      │ fetched with revalidate: 120
                                      ▼
                  ┌──────────────────────────────────────────────┐
   USGS + NWS ───▶│ Vercel: shelf join → event router → UI       │
   (live, keyless)│ / (events) · /wall (ambient) · /map          │
                  └──────────────────────────────────────────────┘
```

**Why the `data` branch.** Vercel Hobby allows 100 deployments/day; a 10-minute
sweep would produce 144 commits/day and exhaust that. `vercel.json` sets
`git.deploymentEnabled.data = false`, so worker commits never trigger a build.
The app reads the JSON at runtime from `raw.githubusercontent.com` and caches it
at the Vercel edge.

**Why GitHub Actions is the scheduler.** Vercel Hobby cron runs *once per day*,
max 2 jobs. Actions gives 5-minute granularity and unlimited minutes on a public
repo, and can run for 12 minutes per job. All scheduling lives there; Vercel is
purely the read layer.

## Health: a state machine, not a boolean

```
LIVE --2 fails--> DEGRADED --5 fails--> STALE --24h--> DEAD --30d--> RETIRED
  ^                   |                    |             |
  +---1 success-------+--------------------+-------------+
```

Hysteresis means one flaky probe never blanks a tile and one lucky probe never
promotes a dead camera. Observed in practice: a sweep at 93% success produced
zero demotions, which is correct.

**Probe ladder** (`src/lib/probe.ts`), cheapest first:

| Kind | Check | Catches |
|---|---|---|
| `image` | 200 + `content-type: image/*` + >3KB | dead URLs, offline placeholder cards |
| `hls` | manifest parses → follow to chunklist → `#EXTINF` segments exist | 200-but-broken streams |
| both | signature identical to last sweep → `frozenStreak++` | **camera up, showing nothing** |

That last row is the failure mode status codes cannot see. Six identical
signatures in a row demotes to DEGRADED.

**Tiered cadence.** Probing every camera every 10 minutes would hammer the DOT
hosts. `selectForSweep()` is a priority queue over `tierWeight + overdue` with a
fixed budget (default 700/sweep):

| Tier | Meaning | Interval |
|---|---|---|
| 0 | on screen now | every sweep |
| 1 | routing-eligible | every 3rd |
| 2 | long tail | every 18th |
| 3 | in recovery | exponential backoff to ~24h |

Full coverage of the long tail comes around roughly hourly.

**Nothing dead reaches the screen.** The read path never queries raw sources. It
reads a *shelf* (`getShelf()`) — cameras joined to current health, with anything
not LIVE flagged. Pages request more cameras than they render, so a client that
loses a tile swaps in a standby with no round trip and no visible gap.

**Viewers as probes.** `CameraTile` reports decode failures to `/api/report`.
A browser that just failed on a stream is the most reliable signal available,
and it comes from exactly the cameras someone is watching. On Hobby with no KV
these are logged only; the sweep stays the source of truth.

## Geolocation

The general problem is dirty: titles lie, most streams are not geotagged. **This
data set sidesteps it entirely** — DOT feeds publish surveyed coordinates from
the operating agency, so every camera arrives at the `precise` tier (±50m) with
no LLM extraction needed.

The tier field still gates features, because non-DOT sources will not be so
clean:

| Tier | Radius | Unlocks |
|---|---|---|
| `country` | ±500 km | ambient rotation |
| `city` | ±25 km | weather layer |
| `point` | ±1 km | event routing |
| `precise` | ±100 m | AIS/ADS-B identification joins |

`src/lib/solar.ts` computes sun elevation. Two jobs: keep pitch-black cameras
out of the ambient wall, and — for future untrusted sources — corroborate a
claimed location against observed light/dark transitions. A camera claiming
Boston that brightens at 03:00 local is not in Boston.

## Embeds

The app is live video only, so the poster-wall trick that used to dodge the
embed ceiling is gone and every tile decodes. Two defences in `CameraTile`:

1. **Virtualization.** A player exists only while its tile is on screen
   (IntersectionObserver, 200px margin) and is destroyed when it scrolls away.
2. **A global budget.** At most 8 decoders run at once; tiles beyond that join
   a wait queue and show a placeholder until a slot frees. Hero tiles take a
   slot immediately.

The DOT hosts send `Access-Control-Allow-Origin: *` on HLS, so streams play
directly with no proxy hop and no bandwidth on our side.

`spread()` in `router.ts` keeps one provider or state from filling every slot,
with a per-bucket allowance that scales to how many buckets exist — a fixed cap
would silently halve every result now that the pool is effectively one
provider.

## Data sources

All public, keyless, verified working.

The app indexes live video only, so a source without stream URLs contributes
nothing and is disabled rather than ingested and filtered downstream.

| Source | Indexed | Why |
|---|---|---|
| 511NY | 1,559 | the only NE system publishing `videoUrl` |
| 511PA | 2 | disabled; two cameras with video survive from an earlier ingest |
| New England 511 | 0 | disabled — still images only |
| CT Roads | 0 | disabled — still images only, video auth required |
| NJ / MA | 0 | different platform, endpoint not located |
| **Total** | **1,561** | all HLS |

`discover` prunes both still-image cameras and still-image sources on every run,
so cameras predating the video-only rule do not survive in the registry.

Events: USGS FDSN query API (bbox-filtered, ~2KB) and NWS active alerts with
real polygons. A camera inside an alert polygon scores as distance zero.

## Known limits

- **Actions cron drifts.** GitHub delays scheduled runs under load; 10 minutes
  can become 20. The sweep counter is monotonic rather than wall-clock based, so
  this affects freshness, not correctness.
- **Scheduled workflows auto-disable** after 60 days without repo activity.
- **`raw.githubusercontent.com` caches ~5 minutes**, so health data can be up to
  ~5 min behind the last sweep. Fine against a 10-minute cadence.
- **Viewer reports are not persisted** without a KV store.
- **No archive.** Frame capture over time — the genuinely defensible asset — is
  not built. It needs blob storage.
- **Coverage is New York State**, a direct consequence of the video-only rule.
  Roughly 2,460 still-image cameras across PA, CT, VT, NH and ME are excluded.

## Upgrade path

| Pressure | Change |
|---|---|
| Health freshness | Vercel KV/Upstash for the shelf; drop raw.githubusercontent |
| >10k cameras | Neon Postgres + PostGIS, `ST_DWithin` for routing |
| Archive | Vercel Blob or R2, frame capture in the sweep job |
| YouTube cams | `videos.list` batched 50 IDs/unit; RSS for keyless discovery |
| Per-minute cron | Vercel Pro, or shorten the Actions interval |
