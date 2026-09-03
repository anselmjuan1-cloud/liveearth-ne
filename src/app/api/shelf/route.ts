import { NextResponse } from "next/server";
import { getShelf } from "@/lib/data";
import { haversineKm } from "@/lib/geo";
import { ambientPicks } from "@/lib/router";

export const revalidate = 120;

// Clients never download the whole shelf. They ask for a slice: nearest to a
// point, or an ambient selection. Four thousand cameras stay server-side.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const near = url.searchParams.get("near");
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 24));
  const shelf = await getShelf();

  if (near) {
    const [latRaw, lonRaw] = near.split(",");
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "near must be lat,lon" }, { status: 400 });
    }
    const cameras = shelf
      .map((c) => ({ ...c, distanceKm: haversineKm(c.lat, c.lon, lat, lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
    return NextResponse.json(
      { count: cameras.length, cameras },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
    );
  }

  const cameras = ambientPicks(shelf, limit);
  return NextResponse.json(
    { count: cameras.length, cameras },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
