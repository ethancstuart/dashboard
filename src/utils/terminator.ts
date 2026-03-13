/**
 * Day/night terminator calculation.
 * Returns an array of {lat, lng} points forming the terminator polygon
 * suitable for Globe.gl's polygonsData format.
 */
export interface TerminatorPoint {
  lat: number;
  lng: number;
}

export function buildTerminatorPolygon(): TerminatorPoint[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86400000);

  // Solar declination (Earth's axial tilt effect)
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * Math.PI / 180;

  // Sun longitude based on UTC time
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const sunLon = (12 - hours) * 15;

  const points: TerminatorPoint[] = [];

  for (let lon = -180; lon <= 180; lon += 2) {
    const lonRad = (lon - sunLon) * Math.PI / 180;
    const lat = Math.atan(-Math.cos(lonRad) / Math.tan(decRad)) * 180 / Math.PI;
    points.push({ lat, lng: lon });
  }

  // Close the polygon by extending to the pole on the night side
  const nightOnSouth = declination >= 0;

  if (nightOnSouth) {
    points.push({ lat: -90, lng: 180 });
    points.push({ lat: -90, lng: -180 });
  } else {
    points.push({ lat: 90, lng: 180 });
    points.push({ lat: 90, lng: -180 });
  }

  return points;
}
