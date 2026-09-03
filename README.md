# Live Earth · Northeast

Live public cameras across the Northeast US, routed by what is actually
happening there. When a severe thunderstorm warning goes up over western
Pennsylvania, this shows you the cameras inside the warning polygon.

**1,561 cameras, every one a live HLS video stream.** No still images anywhere
in the app. Every data source is public and needs no API key.

Runs entirely on GitHub + Vercel Hobby. No database.

## How it works

- **Live video only.** Still-image cameras are not indexed at all. Of the
  Northeast 511 systems only NY publishes stream URLs, so coverage is New York
  State (plus two PA cameras that happen to serve video).
- **GitHub Actions is the worker fleet.** `discover` ingests state DOT camera
  feeds every 6 hours; `sweep` health-checks a prioritized slice of cameras
  every 10 minutes. Both commit JSON to an orphan `data` branch.
- **Vercel is the read layer.** It fetches that JSON from
  `raw.githubusercontent.com`, joins it with live USGS and NWS event feeds, and
  routes events to the nearest healthy cameras.
- **A camera is a place, not a URL.** Sources die constantly; cameras don't.
  See [ARCHITECTURE.md](ARCHITECTURE.md) for why that distinction is the whole
  game.

## Pages

| Route | What it is |
|---|---|
| `/` | Event router — active weather alerts and earthquakes, each with the nearest live cameras |
| `/wall` | Ambient mode — a rotating live hero plus more live feeds, daylight-filtered |
| `/map` | All cameras and event polygons on one map |
| `/api/events` | Routed events as JSON |
| `/api/shelf?near=42.9,-78.8&limit=24` | Nearest cameras to a point |

## Setup

```bash
npm install
npm run discover -- --seed   # ingest DOT feeds, write data/registry.seed.json
npm run sweep                # health-check a slice of cameras
npm run dev
```

The repo ships with a 900-camera seed registry, so the app works immediately —
before any Action has run.

Because every tile decodes a real stream, `CameraTile` only creates a player for
tiles actually on screen (IntersectionObserver) and caps concurrent decoders at
8 with a wait queue.

## Deploying

1. Push to a **public** GitHub repo (Actions minutes are unlimited on public
   repos; a private repo would blow the 2,000 min/month free tier in about a
   week at this cadence).
2. Import the repo in Vercel.
3. Set these environment variables so the app reads the `data` branch:

   ```
   NEXT_PUBLIC_GH_OWNER=<your-username>
   NEXT_PUBLIC_GH_REPO=<your-repo>
   NEXT_PUBLIC_GH_DATA_BRANCH=data
   ```

4. In the repo's **Settings → Actions → General**, set Workflow permissions to
   **Read and write**, so the workers can push to the `data` branch.
5. Trigger `discover` manually once (Actions tab → discover → Run workflow) to
   create the branch. `sweep` runs itself every 10 minutes after that.

`vercel.json` disables deployments for the `data` branch — otherwise 144 worker
commits a day would exhaust the Hobby plan's 100-deploy limit.

## Adding a data source

Camera adapters live in `src/lib/sources/`. An adapter returns `Camera[]`; the
merge in `scripts/discover.ts` preserves identity and `firstSeen` so history
survives. NJ and MA are stubbed but disabled — their 511 sites run a different
platform and the endpoint hasn't been located yet.

## Layout

```
src/lib/          types · geo · solar · health · probe · events · router · data
src/lib/sources/  camera ingestion adapters
scripts/          discover · sweep · publish to the data branch
src/app/          Next.js App Router pages and API routes
.github/workflows every-6h discovery, every-10m health sweep
```
