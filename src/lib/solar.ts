// Solar position. Two jobs:
//   1. Don't feature a pitch-black camera in the ambient wall.
//   2. Geolocation corroboration -- observed light/dark transitions in captured
//      frames must match computed sun elevation at the claimed coordinates.
//      A camera claiming Boston that brightens at 03:00 local is not in Boston.
// NOAA low-precision algorithm; accurate to a fraction of a degree, which is
// far more than either job requires.

export function solarElevationDeg(date: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;

  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = (23.439 - 0.0000004 * n) * rad;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  let ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / rad;
  if (ra < 0) ra += 360;

  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon + 360) % 360;
  let ha = (lst - ra + 540) % 360 - 180;
  ha *= rad;

  const phi = lat * rad;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(ha)
  );
  return elevation / rad;
}

/** Below civil twilight: a visible-light camera shows essentially nothing. */
export function isNight(date: Date, lat: number, lon: number): boolean {
  return solarElevationDeg(date, lat, lon) < -6;
}

/** 0 at night, 1 in full day, smooth across twilight. Used for ambient ranking. */
export function daylightFactor(date: Date, lat: number, lon: number): number {
  const e = solarElevationDeg(date, lat, lon);
  if (e <= -6) return 0;
  if (e >= 10) return 1;
  return (e + 6) / 16;
}
