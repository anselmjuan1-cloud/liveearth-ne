import { NextResponse } from "next/server";
import { getShelf } from "@/lib/data";
import { getEvents } from "@/lib/events";
import { routeAll } from "@/lib/router";

export const revalidate = 120;

export async function GET() {
  const [shelf, events] = await Promise.all([getShelf(), getEvents()]);
  const routed = routeAll(events, shelf, 10);
  return NextResponse.json(
    { generatedAt: new Date().toISOString(), count: routed.length, events: routed },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
  );
}
