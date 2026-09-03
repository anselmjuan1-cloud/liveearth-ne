/** Northeast US bounding box: NY, PA, NJ, CT, RI, MA, VT, NH, ME. */
export const NE_BBOX = { minLat: 38.7, maxLat: 47.6, minLon: -80.6, maxLon: -66.8 };

export const NE_STATES = ["NY", "PA", "NJ", "CT", "RI", "MA", "VT", "NH", "ME"];

export function inNortheast(lat: number, lon: number): boolean {
  return (
    lat >= NE_BBOX.minLat && lat <= NE_BBOX.maxLat &&
    lon >= NE_BBOX.minLon && lon <= NE_BBOX.maxLon
  );
}

const R = 6371;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la = (aLat * Math.PI) / 180;
  const lb = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray casting. polygon is [lon, lat] pairs. */
export function pointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Parses "POINT (-78.84 42.92)" from the 511 well-known-text field. */
export function parseWkt(wkt: string): { lat: number; lon: number } | null {
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt);
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
