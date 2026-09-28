import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Lang, isRainy, pm25Band, psiBand } from "./bands.js";
import { nearestN, nearestRegion, resolveLocation, type ResolvedLocation } from "./geo.js";
import {
  REGIONS,
  fetchFourDayOutlook,
  fetchPm25,
  fetchPsi,
  fetchRainfall,
  fetchTwentyFourHourForecast,
  fetchTwoHourForecast,
  type Region,
} from "./nea.js";

export const SERVER_NAME = "sg-haze-rain";
export const SERVER_VERSION = "0.1.0";

/* ---------- shared input schema ---------- */

const regionSchema = z.enum(REGIONS).optional().describe("Force a PSI region instead of locating the caller: north, south, east, west or central.");
const latSchema = z.number().min(-90).max(90).optional().describe("Latitude, if the caller already knows where they are (skips IP lookup).");
const lonSchema = z.number().min(-180).max(180).optional().describe("Longitude, paired with lat.");
const ipSchema = z.string().optional().describe("Geolocate this IP instead of the machine's own public IP.");
const langSchema = z.enum(["en", "zh"]).optional().describe("Language for labels and health advice. Defaults to SG_HAZE_LANG or 'en'.");

const locationInputs = { region: regionSchema, lat: latSchema, lon: lonSchema, ip: ipSchema, lang: langSchema };
type LocationInputs = { region?: Region; lat?: number; lon?: number; ip?: string; lang?: Lang };

function lang(input: { lang?: Lang }): Lang {
  const v = input.lang ?? (process.env.SG_HAZE_LANG as Lang | undefined);
  return v === "zh" ? "zh" : "en";
}

function t(l: Lang, en: string, zh: string): string {
  return l === "zh" ? zh : en;
}

/** "2026-09-28T21:00:00+08:00" -> "28 Sep 2026, 21:00 SGT" */
function fmtTime(iso: string | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " SGT";
}

function regionName(r: Region, l: Lang): string {
  const zh: Record<Region, string> = { north: "北部", south: "南部", east: "东部", west: "西部", central: "中部" };
  return l === "zh" ? zh[r] : r;
}

function describeLocation(loc: ResolvedLocation, region: Region, l: Lang): string {
  const via: Record<ResolvedLocation["source"], string> = {
    region: t(l, "region given by caller", "调用方指定区域"),
    coords: t(l, "coordinates given by caller", "调用方提供坐标"),
    ip: t(l, "located via public IP", "通过公网 IP 定位"),
    default: t(l, "default region", "默认区域"),
  };
  let s = `${t(l, "Location", "位置")}: ${loc.label} → ${t(l, "nearest PSI region", "最近的 PSI 区域")}: ${regionName(region, l)} (${via[loc.source]})`;
  if (loc.source === "ip" && !loc.inSingapore) {
    s += `\n⚠️ ${t(l, "This IP resolves outside Singapore, so readings are for the default region instead.", "该 IP 位于新加坡以外，以下读数为默认区域。")}`;
  }
  if (loc.lookupError && loc.source === "default") {
    s += `\n(${t(l, "IP lookup unavailable", "IP 定位不可用")}: ${loc.lookupError})`;
  }
  return s;
}

/** Where the caller is, plus which PSI region and how we found out. */
async function locate(input: LocationInputs) {
  const loc = await resolveLocation(input);
  const psi = await fetchPsi();
  const region: Region = input.region ?? (loc.inSingapore ? nearestRegion(psi.regions, loc) : nearestRegion(psi.regions, { lat: 1.35735, lon: 103.82 }));
  return { loc, region, psi };
}

/* ---------- haze ---------- */

async function hazeReport(input: LocationInputs) {
  const l = lang(input);
  const { loc, region, psi } = await locate(input);
  const pm25 = await fetchPm25();

  const psi24 = psi.readings.psi_twenty_four_hourly?.[region];
  const pm25h1 = pm25.pm25OneHourly[region];
  const pm25h24 = psi.readings.pm25_twenty_four_hourly?.[region];
  const pm10h24 = psi.readings.pm10_twenty_four_hourly?.[region];
  if (psi24 === undefined) throw new Error(`No PSI reading for region "${region}" in the current NEA feed`);

  const band = psiBand(psi24, l);
  const pmBand = pm25h1 !== undefined ? pm25Band(pm25h1, l) : undefined;

  const allRegions = REGIONS.map((r) => `${regionName(r, l)} ${psi.readings.psi_twenty_four_hourly?.[r] ?? "–"}`).join(" · ");

  const lines = [
    `🌫️ ${t(l, "Singapore haze", "新加坡烟霾")} — ${fmtTime(psi.updatedTimestamp)}`,
    describeLocation(loc, region, l),
    ``,
    `${t(l, "24-hr PSI", "24小时 PSI")}: **${psi24}** — ${band.label} (${band.range})`,
    pm25h1 !== undefined && pmBand ? `${t(l, "1-hr PM2.5", "1小时 PM2.5")}: **${pm25h1} µg/m³** — ${pmBand.label} (${t(l, "Band", "等级")} ${pmBand.band})` : undefined,
    pm25h24 !== undefined ? `${t(l, "24-hr PM2.5", "24小时 PM2.5")}: ${pm25h24} µg/m³` : undefined,
    pm10h24 !== undefined ? `${t(l, "24-hr PM10", "24小时 PM10")}: ${pm10h24} µg/m³` : undefined,
    ``,
    `${t(l, "Health advisory", "健康建议")} (${band.label}):`,
    `• ${t(l, "General public", "一般人群")}: ${band.general}`,
    `• ${t(l, "Elderly, pregnant women, children", "老人、孕妇、儿童")}: ${band.sensitive}`,
    `• ${t(l, "Chronic lung / heart conditions", "慢性肺病或心脏病患者")}: ${band.chronic}`,
    band.mask ? `• ${t(l, "Masks", "口罩")}: ${band.mask}` : undefined,
    ``,
    `${t(l, "All regions (24-hr PSI)", "各区域 24小时 PSI")}: ${allRegions}`,
    `${t(l, "Source", "数据来源")}: NEA via data.gov.sg`,
  ].filter((s): s is string => s !== undefined);

  return {
    text: lines.join("\n"),
    data: {
      region,
      location: loc,
      updatedAt: psi.updatedTimestamp,
      psi24h: psi24,
      psiBand: { key: band.key, label: band.label, range: band.range },
      pm25_1h: pm25h1,
      pm25Band: pmBand ? { key: pmBand.key, band: pmBand.band, label: pmBand.label } : undefined,
      pm25_24h: pm25h24,
      pm10_24h: pm10h24,
      advisory: { general: band.general, sensitive: band.sensitive, chronic: band.chronic, mask: band.mask },
      allRegions: {
        psi24h: psi.readings.psi_twenty_four_hourly,
        pm25_1h: pm25.pm25OneHourly,
      },
      subIndices: Object.fromEntries(
        Object.entries(psi.readings)
          .filter(([k]) => k.endsWith("_sub_index"))
          .map(([k, v]) => [k, (v as Record<string, number>)[region]]),
      ),
      source: "NEA via data.gov.sg",
    },
  };
}

/* ---------- rain ---------- */

async function rainReport(input: LocationInputs) {
  const l = lang(input);
  const { loc, region } = await locate(input);
  const from = loc.inSingapore ? loc : { lat: 1.35735, lon: 103.82 };
  const [rain, twoHr] = await Promise.all([fetchRainfall(), fetchTwoHourForecast()]);

  const nearStations = nearestN(rain.stations, from, 3);
  const wetNearby = nearStations.some((s) => s.item.value > 0);
  const wetAnywhere = rain.stations.filter((s) => s.value > 0);
  const area = nearestN(twoHr.areas, from, 1)[0];
  const rainForecast = area ? isRainy(area.item.forecast) : false;

  const status = wetNearby
    ? t(l, "🌧️ Raining near you right now", "🌧️ 你附近正在下雨")
    : rainForecast
      ? t(l, "☁️ Dry now, rain expected within 2 hours", "☁️ 目前没雨，未来两小时预计有雨")
      : t(l, "☀️ No rain nearby", "☀️ 附近没有下雨");

  const lines = [
    `${status} — ${fmtTime(rain.timestamp)}`,
    describeLocation(loc, region, l),
    ``,
    `${t(l, "Nearest rain gauges (5-minute total)", "最近的雨量站（5分钟累计）")}:`,
    ...nearStations.map((s) => `• ${s.item.name} (${s.distanceKm.toFixed(1)} km): ${s.item.value} ${rain.unit}`),
    ``,
    area
      ? `${t(l, "2-hour forecast", "2小时预报")} ${area.item.name} (${area.distanceKm.toFixed(1)} km): **${area.item.forecast}** — ${twoHr.validPeriod.text}`
      : undefined,
    ``,
    `${t(l, "Island-wide", "全岛")}: ${wetAnywhere.length}/${rain.stations.length} ${t(l, "stations reporting rain", "个站点有雨")}` +
      (wetAnywhere.length ? ` (${wetAnywhere.slice(0, 5).map((s) => `${s.name} ${s.value}`).join(", ")}${wetAnywhere.length > 5 ? ", …" : ""})` : ""),
    `${t(l, "Source", "数据来源")}: NEA via data.gov.sg`,
  ].filter((s): s is string => s !== undefined);

  return {
    text: lines.join("\n"),
    data: {
      region,
      location: loc,
      observedAt: rain.timestamp,
      rainingNearby: wetNearby,
      rainExpectedWithin2h: rainForecast,
      unit: rain.unit,
      nearestStations: nearStations.map((s) => ({ ...s.item, distanceKm: Number(s.distanceKm.toFixed(2)) })),
      twoHourForecast: area ? { area: area.item.name, forecast: area.item.forecast, distanceKm: Number(area.distanceKm.toFixed(2)), validPeriod: twoHr.validPeriod } : undefined,
      islandWide: { stationsReportingRain: wetAnywhere.length, stationsTotal: rain.stations.length, wetStations: wetAnywhere.map((s) => ({ name: s.name, value: s.value })) },
      source: "NEA via data.gov.sg",
    },
  };
}

/* ---------- forecast ---------- */

async function forecastReport(input: LocationInputs & { horizon?: "2h" | "24h" | "4d" }) {
  const l = lang(input);
  const horizon = input.horizon ?? "24h";
  const { loc, region } = await locate(input);
  const from = loc.inSingapore ? loc : { lat: 1.35735, lon: 103.82 };
  const header = describeLocation(loc, region, l);

  if (horizon === "2h") {
    const f = await fetchTwoHourForecast();
    const near = nearestN(f.areas, from, 3);
    const lines = [
      `⏱️ ${t(l, "2-hour nowcast", "2小时短时预报")} — ${f.validPeriod.text} (${t(l, "updated", "更新于")} ${fmtTime(f.updatedTimestamp)})`,
      header,
      ``,
      ...near.map((a) => `• ${a.item.name} (${a.distanceKm.toFixed(1)} km): ${a.item.forecast}`),
      `${t(l, "Source", "数据来源")}: NEA via data.gov.sg`,
    ];
    return { text: lines.join("\n"), data: { horizon, region, location: loc, validPeriod: f.validPeriod, updatedAt: f.updatedTimestamp, nearestAreas: near.map((a) => ({ ...a.item, distanceKm: Number(a.distanceKm.toFixed(2)) })), allAreas: f.areas.map((a) => ({ name: a.name, forecast: a.forecast })), source: "NEA via data.gov.sg" } };
  }

  if (horizon === "4d") {
    const f = await fetchFourDayOutlook();
    const lines = [
      `📅 ${t(l, "4-day outlook", "4天展望")} (${t(l, "updated", "更新于")} ${fmtTime(f.updatedTimestamp)})`,
      ...f.days.map((d) => `• ${d.day} ${d.date}: ${d.forecast.text.trim()}${d.forecast.summary ? ` — ${d.forecast.summary.trim()}` : ""}; ${d.temperature.low}–${d.temperature.high}°C, RH ${d.relativeHumidity.low}–${d.relativeHumidity.high}%, ${t(l, "wind", "风")} ${d.wind.direction} ${d.wind.speed.low}–${d.wind.speed.high} km/h`),
      `${t(l, "Source", "数据来源")}: NEA via data.gov.sg`,
    ];
    return { text: lines.join("\n"), data: { horizon, updatedAt: f.updatedTimestamp, days: f.days, source: "NEA via data.gov.sg" } };
  }

  const f = await fetchTwentyFourHourForecast();
  const g = f.general;
  const lines = [
    `🗓️ ${t(l, "24-hour forecast", "24小时预报")} — ${g.validPeriod?.text ?? ""} (${t(l, "updated", "更新于")} ${fmtTime(f.updatedTimestamp)})`,
    header,
    ``,
    `${t(l, "General", "总体")}: **${g.forecast.text}**, ${g.temperature.low}–${g.temperature.high}°C, RH ${g.relativeHumidity.low}–${g.relativeHumidity.high}%, ${t(l, "wind", "风")} ${g.wind.direction} ${g.wind.speed.low}–${g.wind.speed.high} km/h`,
    ``,
    `${t(l, "Your region", "你的区域")} (${regionName(region, l)}):`,
    ...f.periods.map((p) => `• ${p.timePeriod.text}: ${p.regions[region]?.text ?? "–"}`),
    `${t(l, "Source", "数据来源")}: NEA via data.gov.sg`,
  ];
  return {
    text: lines.join("\n"),
    data: { horizon, region, location: loc, updatedAt: f.updatedTimestamp, general: g, periods: f.periods.map((p) => ({ period: p.timePeriod, forRegion: p.regions[region], allRegions: p.regions })), source: "NEA via data.gov.sg" },
  };
}

/* ---------- server ---------- */

type ToolResult = { text: string; data: unknown };

function toContent(r: ToolResult) {
  return {
    content: [{ type: "text" as const, text: r.text }],
    structuredContent: r.data as Record<string, unknown>,
  };
}

function toError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `sg-haze-rain: ${msg}` }], isError: true };
}

async function run(fn: () => Promise<ToolResult>) {
  try {
    return toContent(await fn());
  } catch (err) {
    return toError(err);
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "weather_now",
    {
      title: "Singapore weather now (haze + rain)",
      description:
        "One-call summary for the caller's location in Singapore: 24-hr PSI and 1-hr PM2.5 with NEA's health advisory, whether it is raining nearby, and the 2-hour forecast. Location comes from the caller's public IP unless region / lat+lon / ip is given.",
      inputSchema: locationInputs,
    },
    async (input) =>
      run(async () => {
        const [h, r] = await Promise.all([hazeReport(input), rainReport(input)]);
        const hazeLines = h.text.split("\n");
        const rainLines = r.text.split("\n");
        // Drop the duplicated location line from the rain block and the trailing source lines.
        const text = [
          ...hazeLines.filter((s) => !s.startsWith("Source:") && !s.startsWith("数据来源")),
          "",
          rainLines[0],
          ...rainLines.slice(2),
        ].join("\n");
        return { text, data: { haze: h.data, rain: r.data } };
      }),
  );

  server.registerTool(
    "get_haze",
    {
      title: "Singapore haze (PSI / PM2.5)",
      description:
        "Current haze for the caller's nearest PSI region: 24-hr PSI, 1-hr PM2.5, 24-hr PM2.5/PM10, the NEA band and health advisory, plus all five regions for comparison. Data: NEA via data.gov.sg, refreshed hourly.",
      inputSchema: locationInputs,
    },
    async (input) => run(() => hazeReport(input)),
  );

  server.registerTool(
    "get_rain",
    {
      title: "Singapore rain now",
      description:
        "Is it raining near the caller? Uses NEA's 5-minute rain-gauge network (nearest three stations) plus the 2-hour area forecast; also counts wet stations island-wide.",
      inputSchema: locationInputs,
    },
    async (input) => run(() => rainReport(input)),
  );

  server.registerTool(
    "get_forecast",
    {
      title: "Singapore weather forecast",
      description: "NEA forecast for the caller's area/region. horizon: '2h' (area nowcast), '24h' (default; general + regional periods) or '4d' (island-wide outlook).",
      inputSchema: {
        ...locationInputs,
        horizon: z.enum(["2h", "24h", "4d"]).optional().describe("Forecast horizon. Default 24h."),
      },
    },
    async (input) => run(() => forecastReport(input)),
  );

  server.registerTool(
    "locate_me",
    {
      title: "Locate caller in Singapore",
      description: "Resolve the caller's location (public IP by default) to coordinates and the nearest NEA PSI region. Useful to check what the other tools will use before calling them.",
      inputSchema: { ip: ipSchema, lat: latSchema, lon: lonSchema, lang: langSchema },
    },
    async (input) =>
      run(async () => {
        const l = lang(input);
        const { loc, region } = await locate(input);
        return {
          text: describeLocation(loc, region, l) + `\n${t(l, "Coordinates", "坐标")}: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`,
          data: { location: loc, region },
        };
      }),
  );

  server.registerPrompt(
    "haze_check",
    {
      title: "Should I go outside? (haze + rain)",
      description: "Ask the assistant for a plain-language go/no-go on outdoor plans using current haze and rain.",
      argsSchema: { activity: z.string().optional().describe("What you plan to do outdoors, e.g. 'run 5 km at 6pm'") },
    },
    ({ activity }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Call the weather_now tool, then tell me in two or three sentences whether it is a good idea to ${activity ?? "be outdoors right now"} in Singapore. Quote the PSI band and rain status, and follow NEA's health advisory for the general public.`,
          },
        },
      ],
    }),
  );

  return server;
}
