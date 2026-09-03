import Wall from "@/components/Wall";
import { getShelf } from "@/lib/data";
import { ambientPicks } from "@/lib/router";

export const revalidate = 120;

export default async function WallPage() {
  const shelf = await getShelf();
  // Daylit cameras with real video, spread across states so the wall is not
  // twelve views of the same interchange.
  const picks = ambientPicks(shelf, 14);

  return (
    <>
      <div className="stats">
        <span>
          <b>{picks.length}</b> tiles
        </span>
        <span>selected for daylight, live video, and geographic spread</span>
      </div>
      <div style={{ height: 22 }} />
      <Wall cameras={picks} />
    </>
  );
}
