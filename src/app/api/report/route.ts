import { NextResponse } from "next/server";

// Viewer-reported failures. A browser that just failed to decode a stream is
// the single most reliable health signal available, and it comes from exactly
// the cameras that matter -- the ones someone is looking at.
//
// On Vercel Hobby with no database attached these are logged only, and the
// 10-minute sweep remains the source of truth. Persisting them (so a viewer
// report can demote a camera immediately) needs a KV store; see ARCHITECTURE.md.

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; kind?: string };
    if (!body.id) return NextResponse.json({ ok: false }, { status: 400 });
    console.log(`[viewer-report] ${body.id} kind=${body.kind ?? "?"}`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
