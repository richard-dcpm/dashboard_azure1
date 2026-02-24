import * as exifr from "exifr";

export async function extractGpsFromFile(file) {
  if (!file) return null;
  try {
    const gps = await exifr.gps(file);
    if (gps?.latitude && gps?.longitude) {
      return { lat: gps.latitude, lon: gps.longitude };
    }
  } catch {}
  return null;
}

export async function extractGpsFromUrl(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, { mode: "cors" });
    const blob = await resp.blob();
    const gps = await exifr.gps(blob);
    if (gps?.latitude && gps?.longitude) {
      return { lat: gps.latitude, lon: gps.longitude };
    }
  } catch {}
  return null;
}

export function parseLatLonFromName(name) {
  const m = name?.match(/(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { lat: +m[1], lon: +m[2] };
}
