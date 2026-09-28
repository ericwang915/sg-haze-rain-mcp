/**
 * Thin client for NEA's real-time environment feeds, published through
 * data.gov.sg (https://api-open.data.gov.sg/v2/real-time/api/...).
 *
 * Every function returns a normalised, camel-cased shape so the rest of the
 * server does not care that some feeds use snake_case and others camelCase.
 */

export const REGIONS = ["north", "south", "east", "west", "central"] as const;
export type Region = (typeof REGIONS)[number];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RegionPoint extends LatLon {
  name: Region;
}

export interface PsiSnapshot {
  timestamp: string;
  updatedTimestamp: string;
  regions: RegionPoint[];
  /** e.g. readings.psi_twenty_four_hourly.central */
  readings: Record<string, Partial<Record<Region, number>>>;
}

export interface Pm25Snapshot {
  timestamp: string;
  updatedTimestamp: string;
  regions: RegionPoint[];
  pm25OneHourly: Partial<Record<Region, number>>;
}

export interface RainStation extends LatLon {
  id: string;
  name: string;
  /** mm of rain in the 5-minute window ending at `timestamp` */
  value: number;
}

export interface RainSnapshot {
  timestamp: string;
  unit: string;
  readingType: string;
  stations: RainStation[];
}

export interface AreaForecast extends LatLon {
  name: string;
  forecast: string;
}

export interface TwoHourSnapshot {
  timestamp: string;
  updatedTimestamp: string;
  validPeriod: { start: string; end: string; text: string };
  areas: AreaForecast[];
}

export interface Range {
  low: number;
  high: number;
  unit?: string;
}

export interface TwentyFourHourSnapshot {
  date: string;
  updatedTimestamp: string;
  general: {
    forecast: { code: string; text: string };
    temperature: Range;
    relativeHumidity: Range;
    wind: { speed: Range; direction: string };
    validPeriod: { start: string; end: string; text: string };
  };
  periods: Array<{
    timePeriod: { start: string; end: string; text: string };
    regions: Record<Region, { code: string; text: string }>;
  }>;
}

export interface FourDaySnapshot {
  date: string;
  updatedTimestamp: string;
  days: Array<{
    day: string;
    date: string;
    forecast: { code: string; text: string; summary?: string };
    temperature: Range;
    relativeHumidity: Range;
    wind: { speed: Range; direction: string };
  }>;
}

const BASE_URL = process.env.SG_HAZE_API_BASE ?? "https://api-open.data.gov.sg/v2/real-time/api";
const CACHE_TTL_MS = Number(process.env.SG_HAZE_CACHE_SECONDS ?? "60") * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const cache = new Map<string, { at: number; value: unknown }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * data.gov.sg rate-limits bursts (HTTP 429). We retry a couple of times with
 * backoff, honouring Retry-After when present, and if the feed still refuses
 * we serve the last good copy we have (marked stale) rather than failing.
 */
async function getJson<T = unknown>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const attempts = 3;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}/${path}`, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "sg-haze-rain-mcp" },
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt;
        lastErr = new Error(`NEA feed ${path} returned HTTP ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
        if (attempt < attempts) {
          await sleep(Math.min(waitMs, 8000));
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(`NEA feed ${path} returned HTTP ${res.status}`);
      const body = (await res.json()) as { code?: number; errorMsg?: string; data?: T };
      if (body.code !== undefined && body.code !== 0) {
        throw new Error(`NEA feed ${path} returned code ${body.code}: ${body.errorMsg ?? "unknown error"}`);
      }
      const data = (body.data ?? body) as T;
      cache.set(path, { at: Date.now(), value: data });
      return data;
    } catch (err) {
      lastErr = (err as Error).name === "AbortError"
        ? new Error(`NEA feed ${path} timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
        : (err as Error);
      if (attempt < attempts) {
        await sleep(1000 * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (hit) {
    // Stale but real data beats an error for a "how is the haze" question.
    console.error(`sg-haze-rain: serving cached ${path} from ${new Date(hit.at).toISOString()} because ${lastErr?.message}`);
    return hit.value as T;
  }
  throw lastErr ?? new Error(`NEA feed ${path} unavailable`);
}

/* ---------- helpers for the mixed camel/snake payloads ---------- */

type AnyObj = Record<string, any>;

function pick<T = any>(obj: AnyObj | undefined, ...keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k] as T;
  return undefined;
}

function toLatLon(loc: AnyObj | undefined): LatLon {
  return {
    lat: Number(pick(loc, "latitude", "lat")),
    lon: Number(pick(loc, "longitude", "lon", "lng")),
  };
}

function toRegions(meta: AnyObj[] | undefined): RegionPoint[] {
  const out: RegionPoint[] = [];
  for (const m of meta ?? []) {
    const name = String(m.name ?? "").toLowerCase() as Region;
    if (!REGIONS.includes(name)) continue;
    out.push({ name, ...toLatLon(pick(m, "labelLocation", "label_location")) });
  }
  return out;
}

/* ---------- public fetchers ---------- */

export async function fetchPsi(): Promise<PsiSnapshot> {
  const d = await getJson<AnyObj>("psi");
  const item = (d.items ?? [])[0];
  if (!item) throw new Error("NEA PSI feed has no readings right now");
  return {
    timestamp: item.timestamp,
    updatedTimestamp: pick(item, "updatedTimestamp", "update_timestamp") ?? item.timestamp,
    regions: toRegions(pick(d, "regionMetadata", "region_metadata")),
    readings: item.readings ?? {},
  };
}

export async function fetchPm25(): Promise<Pm25Snapshot> {
  const d = await getJson<AnyObj>("pm25");
  const item = (d.items ?? [])[0];
  if (!item) throw new Error("NEA PM2.5 feed has no readings right now");
  return {
    timestamp: item.timestamp,
    updatedTimestamp: pick(item, "updatedTimestamp", "update_timestamp") ?? item.timestamp,
    regions: toRegions(pick(d, "regionMetadata", "region_metadata")),
    pm25OneHourly: item.readings?.pm25_one_hourly ?? {},
  };
}

export async function fetchRainfall(): Promise<RainSnapshot> {
  const d = await getJson<AnyObj>("rainfall");
  const reading = (d.readings ?? [])[0];
  if (!reading) throw new Error("NEA rainfall feed has no readings right now");
  const values = new Map<string, number>();
  for (const r of reading.data ?? []) values.set(String(pick(r, "stationId", "station_id")), Number(r.value));
  const stations: RainStation[] = [];
  for (const s of d.stations ?? []) {
    const id = String(s.id ?? pick(s, "deviceId", "device_id"));
    const v = values.get(id);
    if (v === undefined || Number.isNaN(v)) continue;
    stations.push({ id, name: s.name, ...toLatLon(s.location), value: v });
  }
  return {
    timestamp: reading.timestamp,
    unit: pick(d, "readingUnit", "reading_unit") ?? "mm",
    readingType: pick(d, "readingType", "reading_type") ?? "Rainfall 5 Minute Total",
    stations,
  };
}

export async function fetchTwoHourForecast(): Promise<TwoHourSnapshot> {
  const d = await getJson<AnyObj>("two-hr-forecast");
  const item = (d.items ?? [])[0];
  if (!item) throw new Error("NEA 2-hour forecast has no items right now");
  const points = new Map<string, LatLon>();
  for (const a of pick<AnyObj[]>(d, "area_metadata", "areaMetadata") ?? []) {
    points.set(a.name, toLatLon(pick(a, "label_location", "labelLocation")));
  }
  const areas: AreaForecast[] = [];
  for (const f of item.forecasts ?? []) {
    const p = points.get(f.area);
    if (!p) continue;
    areas.push({ name: f.area, forecast: f.forecast, ...p });
  }
  const vp = pick<AnyObj>(item, "valid_period", "validPeriod") ?? {};
  return {
    timestamp: item.timestamp,
    updatedTimestamp: pick(item, "update_timestamp", "updatedTimestamp") ?? item.timestamp,
    validPeriod: { start: vp.start, end: vp.end, text: vp.text },
    areas,
  };
}

export async function fetchTwentyFourHourForecast(): Promise<TwentyFourHourSnapshot> {
  const d = await getJson<AnyObj>("twenty-four-hr-forecast");
  const rec = (d.records ?? d.items ?? [])[0];
  if (!rec) throw new Error("NEA 24-hour forecast has no records right now");
  const g = rec.general ?? {};
  return {
    date: rec.date,
    updatedTimestamp: pick(rec, "updatedTimestamp", "update_timestamp") ?? rec.timestamp,
    general: {
      forecast: g.forecast ?? { code: "", text: "" },
      temperature: g.temperature,
      relativeHumidity: pick<Range>(g, "relativeHumidity", "relative_humidity") ?? { low: NaN, high: NaN },
      wind: g.wind,
      validPeriod: pick(g, "validPeriod", "valid_period") ?? { start: "", end: "", text: "" },
    },
    periods: (rec.periods ?? []).map((p: AnyObj) => ({
      timePeriod: pick(p, "timePeriod", "time_period", "time"),
      regions: p.regions,
    })),
  };
}

export async function fetchFourDayOutlook(): Promise<FourDaySnapshot> {
  const d = await getJson<AnyObj>("four-day-outlook");
  const rec = (d.records ?? d.items ?? [])[0];
  if (!rec) throw new Error("NEA 4-day outlook has no records right now");
  return {
    date: rec.date,
    updatedTimestamp: pick(rec, "updatedTimestamp", "update_timestamp") ?? rec.timestamp,
    days: (rec.forecasts ?? []).map((f: AnyObj) => ({
      day: f.day,
      date: String(f.timestamp ?? f.date ?? "").slice(0, 10),
      forecast: f.forecast,
      temperature: f.temperature,
      relativeHumidity: pick<Range>(f, "relativeHumidity", "relative_humidity") ?? { low: NaN, high: NaN },
      wind: f.wind,
    })),
  };
}
