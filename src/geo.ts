/**
 * Locating the caller: explicit region, explicit coordinates, or a
 * best-effort IP geolocation lookup, in that order of preference.
 */
import { REGIONS, type LatLon, type Region, type RegionPoint } from "./nea.js";

export type LocationSource = "region" | "coords" | "ip" | "default";

export interface ResolvedLocation extends LatLon {
  source: LocationSource;
  /** Human-readable label: "Bishan, Singapore", "1.35, 103.82", "central region" */
  label: string;
  inSingapore: boolean;
  ip?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  /** Set when the lookup was attempted but failed, so callers can explain the fallback. */
  lookupError?: string;
}

/** Rough bounding box of Singapore plus a little sea margin. */
const SG_BOUNDS = { latMin: 1.13, latMax: 1.50, lonMin: 103.55, lonMax: 104.15 };

/** Fallback coordinates for each PSI region (NEA's label locations). */
export const REGION_ANCHORS: Record<Region, LatLon> = {
  north: { lat: 1.41803, lon: 103.82 },
  south: { lat: 1.29587, lon: 103.82 },
  east: { lat: 1.35735, lon: 103.94 },
  west: { lat: 1.35735, lon: 103.7 },
  central: { lat: 1.35735, lon: 103.82 },
};

export function isInSingapore(p: LatLon): boolean {
  return p.lat >= SG_BOUNDS.latMin && p.lat <= SG_BOUNDS.latMax && p.lon >= SG_BOUNDS.lonMin && p.lon <= SG_BOUNDS.lonMax;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestN<T extends LatLon>(items: T[], from: LatLon, n: number): Array<{ item: T; distanceKm: number }> {
  return items
    .map((item) => ({ item, distanceKm: haversineKm(from, item) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

export function nearestRegion(regions: RegionPoint[], from: LatLon): Region {
  const pts = regions.length ? regions : REGIONS.map((name) => ({ name, ...REGION_ANCHORS[name] }));
  return nearestN(pts, from, 1)[0]?.item.name ?? defaultRegion();
}

export function defaultRegion(): Region {
  const env = (process.env.SG_HAZE_DEFAULT_REGION ?? "central").toLowerCase() as Region;
  return REGIONS.includes(env) ? env : "central";
}

export function ipLookupEnabled(): boolean {
  const v = (process.env.SG_HAZE_IP_LOOKUP ?? "on").toLowerCase();
  return !["off", "0", "false", "no"].includes(v);
}

/* ---------- IP geolocation ---------- */

interface IpGeo {
  lat: number;
  lon: number;
  ip?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

const GEO_TIMEOUT_MS = 6_000;

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "sg-haze-rain-mcp" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Two independent free providers; whichever answers first with coordinates wins. */
const GEO_PROVIDERS: Array<{ name: string; url: (ip?: string) => string; parse: (j: any) => IpGeo | null }> = [
  {
    name: "ipwho.is",
    url: (ip) => `https://ipwho.is/${ip ?? ""}`,
    parse: (j) =>
      j && j.success !== false && typeof j.latitude === "number"
        ? { lat: j.latitude, lon: j.longitude, ip: j.ip, city: j.city, country: j.country, countryCode: j.country_code }
        : null,
  },
  {
    name: "ipapi.co",
    url: (ip) => (ip ? `https://ipapi.co/${ip}/json/` : "https://ipapi.co/json/"),
    parse: (j) =>
      j && !j.error && typeof j.latitude === "number"
        ? { lat: j.latitude, lon: j.longitude, ip: j.ip, city: j.city, country: j.country_name, countryCode: j.country_code }
        : null,
  },
];

export async function geolocateIp(ip?: string): Promise<IpGeo> {
  const errors: string[] = [];
  for (const p of GEO_PROVIDERS) {
    try {
      const parsed = p.parse(await fetchJsonWithTimeout(p.url(ip)));
      if (parsed) return parsed;
      errors.push(`${p.name}: no coordinates in response`);
    } catch (err) {
      errors.push(`${p.name}: ${(err as Error).message}`);
    }
  }
  throw new Error(`IP geolocation failed (${errors.join("; ")})`);
}

/* ---------- the one entry point tools use ---------- */

export interface LocateOptions {
  region?: Region;
  lat?: number;
  lon?: number;
  ip?: string;
}

/**
 * Turn whatever the caller gave us into a point in (or near) Singapore.
 * Never throws: on failure it falls back to the default region and records why.
 */
export async function resolveLocation(opts: LocateOptions = {}): Promise<ResolvedLocation> {
  if (opts.region) {
    const anchor = REGION_ANCHORS[opts.region];
    return { ...anchor, source: "region", label: `${opts.region} region`, inSingapore: true };
  }
  if (typeof opts.lat === "number" && typeof opts.lon === "number") {
    const p = { lat: opts.lat, lon: opts.lon };
    return { ...p, source: "coords", label: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, inSingapore: isInSingapore(p) };
  }

  const fallback = (why?: string): ResolvedLocation => {
    const r = defaultRegion();
    return { ...REGION_ANCHORS[r], source: "default", label: `${r} region (default)`, inSingapore: true, lookupError: why };
  };

  if (!ipLookupEnabled()) return fallback("IP lookup disabled via SG_HAZE_IP_LOOKUP=off");

  try {
    const g = await geolocateIp(opts.ip);
    const p = { lat: g.lat, lon: g.lon };
    const place = [g.city, g.country].filter(Boolean).join(", ") || `${g.lat.toFixed(3)}, ${g.lon.toFixed(3)}`;
    return { ...p, source: "ip", label: place, inSingapore: isInSingapore(p), ip: g.ip, city: g.city, country: g.country, countryCode: g.countryCode };
  } catch (err) {
    return fallback((err as Error).message);
  }
}
